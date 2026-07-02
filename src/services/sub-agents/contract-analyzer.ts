import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { logger } from '../../middleware/logger';
import { safeFetch, SsrfError } from '../../utils/ssrf-guard';

const AI_TIMEOUT_MS = 30_000;

const ContractRequestSchema = z.object({
  url: z.string().url().optional(),
  text: z.string().max(200_000).optional(),
  filename: z.string().optional(),
}).refine((d) => d.url ?? d.text, {
  message: 'Either "url" (PDF/text URL) or "text" (raw contract text) must be provided',
});

interface ContractRisk {
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  clause: string;
}

interface KeyTerm {
  term: string;
  value: string;
  page?: number;
}

interface ContractAnalysis {
  summary: string;
  keyTerms: KeyTerm[];
  risks: ContractRisk[];
  redFlags: string[];
  overallRiskScore: number;
  analyzedAt: string;
}

const SYSTEM_PROMPT = `You are an expert contract attorney and risk analyst. When given a contract, you:
1. Write a concise plain-English summary (3-5 sentences)
2. Extract key terms: parties, dates, payment amounts, termination clauses, IP ownership, liability caps
3. Identify risks with severity levels (low/medium/high/critical)
4. Call out red flags: unusual clauses, missing standard protections, one-sided terms
5. Rate overall risk 1-10 (1=very low risk, 10=extremely risky)

Always return valid JSON matching the requested schema. Be specific and quote relevant clauses.`;

export async function contractAnalyzerHandler(req: Request, res: Response): Promise<void> {
  const parseResult = ContractRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey === 'your_anthropic_api_key') {
    res.status(503).json({ error: 'AI service not configured' });
    return;
  }

  const { url, text } = parseResult.data;

  try {
    let contractText = text ?? '';

    if (url && !text) {
      try {
        contractText = await fetchContractText(url);
      } catch (fetchErr) {
        if (fetchErr instanceof SsrfError) {
          logger.warn('SSRF blocked', { url, reason: fetchErr.message });
          res.status(403).json({ error: 'URL not allowed', url });
          return;
        }
        throw fetchErr;
      }
    }

    if (!contractText.trim()) {
      res.status(400).json({ error: 'No contract content could be extracted' });
      return;
    }

    const analysis = await analyzeContract(contractText, anthropicKey);
    res.json(analysis);
  } catch (err) {
    logger.error('Contract analysis failed', { url, err });
    res.status(502).json({ error: 'Contract analysis failed' });
  }
}

async function fetchContractText(url: string): Promise<string> {
  const resp = await safeFetch(url, {
    timeout: 15000,
    responseType: 'arraybuffer',
  });

  const buffer = Buffer.from(resp.data as ArrayBuffer);
  const contentType = (resp.headers['content-type'] as string) ?? '';

  if (contentType.includes('application/pdf') || buffer.subarray(0, 5).toString() === '%PDF-') {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);
      return pdfData.text.replace(/\s+/g, ' ').trim();
    } catch (err) {
      logger.warn('PDF parsing failed, falling back to raw extraction', { err });
      return buffer.toString('utf-8').replace(/[\x00-\x1F\x7F-\xFF]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50000);
    }
  }

  return buffer.toString('utf-8').replace(/[\x00-\x1F\x7F-\xFF]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50000);
}

async function analyzeContract(contractText: string, apiKey: string): Promise<ContractAnalysis> {
  const client = new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS });

  // Truncate to fit context window while keeping key parts
  const truncated = contractText.length > 80000
    ? contractText.slice(0, 40000) + '\n\n[... MIDDLE SECTION TRUNCATED ...]\n\n' + contractText.slice(-20000)
    : contractText;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Analyze this contract and return a JSON object with these exact fields:
{
  "summary": "string (plain-English overview)",
  "keyTerms": [{"term": "string", "value": "string", "page": number|null}],
  "risks": [{"severity": "low|medium|high|critical", "description": "string", "clause": "string"}],
  "redFlags": ["string"],
  "overallRiskScore": number (1-10)
}

CONTRACT:
${truncated}`,
      },
    ],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  const parsed = JSON.parse(jsonMatch[0]) as Omit<ContractAnalysis, 'analyzedAt'>;

  return {
    ...parsed,
    overallRiskScore: Math.max(1, Math.min(10, parsed.overallRiskScore)),
    analyzedAt: new Date().toISOString(),
  };
}
