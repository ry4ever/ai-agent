import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { logger } from '../../middleware/logger';

const CodeReviewRequestSchema = z.object({
  code: z.string().max(100_000),
  language: z.string().optional(),
  filename: z.string().optional(),
  context: z.string().max(1000).optional(),
});

interface Vulnerability {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  description: string;
  line?: number;
}

interface CodeSmell {
  type: string;
  description: string;
  suggestion: string;
}

interface CodeReviewResult {
  summary: string;
  vulnerabilities: Vulnerability[];
  codeSmells: CodeSmell[];
  suggestions: string[];
  overallScore: number;
  reviewedAt: string;
}

const SYSTEM_PROMPT = `You are a senior security engineer and code reviewer with expertise in OWASP Top 10, secure coding practices, and software architecture.

When reviewing code:
1. Identify all security vulnerabilities (SQL injection, XSS, CSRF, auth issues, insecure deserialization, etc.)
2. Find code smells: dead code, long methods, poor naming, god objects, repeated logic
3. Suggest specific improvements with code examples where helpful
4. Score the code quality 1-10 (1=very poor, 10=excellent)

Be specific: reference line numbers and quote problematic code snippets. Return valid JSON.`;

export async function codeReviewerHandler(req: Request, res: Response): Promise<void> {
  const parseResult = CodeReviewRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey === 'your_anthropic_api_key') {
    res.status(503).json({ error: 'AI service not configured' });
    return;
  }

  const { code, language, filename, context } = parseResult.data;

  try {
    const result = await reviewCode({ code, language, filename, context, apiKey: anthropicKey });
    res.json(result);
  } catch (err) {
    logger.error('Code review failed', { filename, err });
    res.status(502).json({ error: 'Code review failed' });
  }
}

async function reviewCode(params: {
  code: string;
  language?: string;
  filename?: string;
  context?: string;
  apiKey: string;
}): Promise<CodeReviewResult> {
  const { code, language, filename, context, apiKey } = params;
  const client = new Anthropic({ apiKey });

  const langHint = language ?? (filename ? inferLanguage(filename) : 'unknown');
  const contextNote = context ? `\nContext: ${context}` : '';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Review this ${langHint} code${filename ? ` from file: ${filename}` : ''}${contextNote}.

Return a JSON object with:
{
  "summary": "string (2-3 sentence overall assessment)",
  "vulnerabilities": [{"severity": "low|medium|high|critical", "type": "string", "description": "string", "line": number|null}],
  "codeSmells": [{"type": "string", "description": "string", "suggestion": "string"}],
  "suggestions": ["string"],
  "overallScore": number (1-10)
}

CODE:
\`\`\`${langHint}
${code}
\`\`\``,
      },
    ],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  const parsed = JSON.parse(jsonMatch[0]) as Omit<CodeReviewResult, 'reviewedAt'>;

  return {
    ...parsed,
    overallScore: Math.max(1, Math.min(10, parsed.overallScore)),
    reviewedAt: new Date().toISOString(),
  };
}

function inferLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
    py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', java: 'Java',
    cs: 'C#', cpp: 'C++', c: 'C', php: 'PHP', sol: 'Solidity',
    sql: 'SQL', sh: 'bash', yml: 'YAML', yaml: 'YAML',
  };
  return langMap[ext] ?? 'unknown';
}
