import { Request, Response } from 'express';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { logger } from '../../middleware/logger';

const ResearchRequestSchema = z.object({
  question: z.string().min(10).max(500),
  depth: z.enum(['quick', 'standard', 'deep']).default('standard'),
});

interface Citation {
  title: string;
  url: string;
  relevance: number;
}

interface ResearchSection {
  title: string;
  content: string;
}

interface ResearchResult {
  question: string;
  summary: string;
  keyFindings: string[];
  sections: ResearchSection[];
  citations: Citation[];
  confidence: number;
  generatedAt: string;
}

const SYSTEM_PROMPT = `You are an expert research analyst. When given a research question:
1. Write a concise executive summary (3-5 sentences)
2. List 5-8 key findings as bullet points
3. Organize detailed analysis into logical sections
4. Cite all sources with relevance scores
5. Estimate confidence (0-1) based on source quality and consensus

Return valid JSON. Be factual, cite evidence, acknowledge uncertainty.`;

export async function researchSynthHandler(req: Request, res: Response): Promise<void> {
  const parseResult = ResearchRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey === 'your_anthropic_api_key') {
    res.status(503).json({ error: 'AI service not configured' });
    return;
  }

  const { question, depth } = parseResult.data;

  try {
    const result = await synthesizeResearch({ question, depth, apiKey: anthropicKey });
    res.json(result);
  } catch (err) {
    logger.error('Research synthesis failed', { question, err });
    res.status(502).json({ error: 'Research synthesis failed' });
  }
}

async function synthesizeResearch(params: {
  question: string;
  depth: 'quick' | 'standard' | 'deep';
  apiKey: string;
}): Promise<ResearchResult> {
  const { question, depth, apiKey } = params;

  // Gather sources from news API if available
  const sources = await gatherSources(question, depth);

  const client = new Anthropic({ apiKey });
  const sourcesContext = sources.length > 0
    ? `\n\nRelevant sources found:\n${sources.map((s, i) => `${i + 1}. ${s.title} (${s.url}): ${s.snippet}`).join('\n')}`
    : '';

  const maxTokens = depth === 'deep' ? 6000 : depth === 'standard' ? 4000 : 2000;
  const model = depth === 'quick' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Research question: "${question}"${sourcesContext}

Return a JSON object:
{
  "summary": "string (executive summary)",
  "keyFindings": ["string"],
  "sections": [{"title": "string", "content": "string"}],
  "citations": [{"title": "string", "url": "string", "relevance": number (0-1)}],
  "confidence": number (0-1)
}`,
      },
    ],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  const parsed = JSON.parse(jsonMatch[0]) as Omit<ResearchResult, 'question' | 'generatedAt'>;

  // Merge gathered sources with any Claude-generated citations
  const allCitations = [
    ...sources.slice(0, 3).map((s) => ({ title: s.title, url: s.url, relevance: 0.8 })),
    ...(parsed.citations ?? []),
  ].slice(0, 10);

  return {
    question,
    summary: parsed.summary ?? '',
    keyFindings: parsed.keyFindings ?? [],
    sections: parsed.sections ?? [],
    citations: allCitations,
    confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
    generatedAt: new Date().toISOString(),
  };
}

interface RawSource {
  title: string;
  url: string;
  snippet: string;
}

async function gatherSources(question: string, depth: string): Promise<RawSource[]> {
  const newsApiKey = process.env.NEWS_API_KEY;
  if (!newsApiKey || newsApiKey === 'your_news_api_key') return [];

  try {
    const pageSize = depth === 'deep' ? 10 : 5;
    const resp = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: question.slice(0, 100),
        apiKey: newsApiKey,
        pageSize,
        sortBy: 'relevancy',
        language: 'en',
      },
      timeout: 8000,
    });

    interface NewsArticle {
      title?: string;
      url?: string;
      description?: string;
    }
    interface NewsResponse {
      articles?: NewsArticle[];
    }

    const data = resp.data as NewsResponse;
    return (data.articles ?? []).map((a) => ({
      title: a.title ?? '',
      url: a.url ?? '',
      snippet: a.description ?? '',
    }));
  } catch (err) {
    logger.warn('Source gathering failed', { question, err });
    return [];
  }
}
