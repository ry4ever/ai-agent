import { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { logger } from '../../middleware/logger';

const ExtractRequestSchema = z.object({
  url: z.string().url().optional(),
  html: z.string().max(500_000).optional(),
}).refine((data) => data.url ?? data.html, {
  message: 'Either "url" or "html" must be provided',
});

interface ExtractedEntity {
  name: string;
  type: string;
  value: string;
}

interface ExtractResult {
  url: string;
  title: string;
  entities: ExtractedEntity[];
  facts: string[];
  tables: Record<string, string>[][];
  wordCount: number;
  extractedAt: string;
}

export async function extractHandler(req: Request, res: Response): Promise<void> {
  const parseResult = ExtractRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
    return;
  }

  const { url, html: rawHtml } = parseResult.data;

  try {
    let html = rawHtml ?? '';
    let resolvedUrl = url ?? 'inline';

    if (url && !rawHtml) {
      let resp;
      try {
        resp = await axios.get(url, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; AgentBot/1.0)',
            Accept: 'text/html,application/xhtml+xml,*/*',
          },
          maxRedirects: 5,
          // Accept any HTTP status — do not throw on 4xx/5xx from target
          validateStatus: () => true,
        });
      } catch (fetchErr: unknown) {
        const code = (fetchErr as NodeJS.ErrnoException).code ?? 'UNKNOWN';
        logger.error('Failed to fetch URL', { url, code, fetchErr });
        res.status(502).json({
          error: 'Failed to fetch URL',
          reason: code,
          url,
        });
        return;
      }

      if (resp.status >= 400) {
        logger.warn('Target URL returned error status', { url, status: resp.status });
        res.status(502).json({
          error: 'Target URL returned an error',
          targetStatus: resp.status,
          url,
        });
        return;
      }

      html = resp.data as string;
      resolvedUrl = url;
    }

    const result = await extractStructuredData(resolvedUrl, html);
    res.json(result);
  } catch (err) {
    logger.error('Extraction failed', { url, err });
    res.status(500).json({ error: 'Internal extraction error', url });
  }
}

async function extractStructuredData(url: string, html: string): Promise<ExtractResult> {
  const $ = cheerio.load(html);

  // Remove noise
  $('script, style, nav, footer, header, aside, .cookie-banner, #cookie-notice').remove();

  const title =
    $('meta[property="og:title"]').attr('content') ??
    $('h1').first().text().trim() ??
    $('title').text().trim();

  // Extract tables
  const tables: Record<string, string>[][] = [];
  $('table').each((_, tableEl) => {
    const headers: string[] = [];
    $(tableEl)
      .find('th')
      .each((_, th) => {
        headers.push($(th).text().trim());
      });

    const rows: Record<string, string>[] = [];
    $(tableEl)
      .find('tr')
      .each((_, tr) => {
        const cells = $(tr).find('td');
        if (cells.length > 0) {
          const row: Record<string, string> = {};
          cells.each((i, td) => {
            const key = headers[i] ?? `col${i}`;
            row[key] = $(td).text().trim();
          });
          rows.push(row);
        }
      });

    if (rows.length > 0) tables.push(rows);
  });

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(/\s+/).length;

  // Use Claude to extract entities and facts if available
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && anthropicKey !== 'your_anthropic_api_key') {
    try {
      return await extractWithClaude(url, title, bodyText.slice(0, 8000), tables, wordCount);
    } catch (err) {
      logger.warn('Claude extraction failed, using basic extraction', { err });
    }
  }

  // Basic regex extraction fallback
  return basicExtract(url, title, bodyText, tables, wordCount);
}

async function extractWithClaude(
  url: string,
  title: string,
  text: string,
  tables: Record<string, string>[][],
  wordCount: number
): Promise<ExtractResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `Extract structured data from this web page content. Return a JSON object with:
- "entities": array of {name, type, value} (people, companies, numbers, dates, locations)
- "facts": array of key factual statements (max 10)

Page title: ${title}
URL: ${url}
Content: ${text}

Return only valid JSON.`,
      },
    ],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as { entities?: ExtractedEntity[]; facts?: string[] }) : {};

  return {
    url,
    title,
    entities: parsed.entities ?? [],
    facts: parsed.facts ?? [],
    tables,
    wordCount,
    extractedAt: new Date().toISOString(),
  };
}

function basicExtract(
  url: string,
  title: string,
  text: string,
  tables: Record<string, string>[][],
  wordCount: number
): ExtractResult {
  // Extract numbers that look like data points
  const numberMatches = text.match(/\$[\d,]+\.?\d*[KMB]?|\d+\.?\d*[KMB]?\s*(?:million|billion|percent|%)/gi) ?? [];
  const entities: ExtractedEntity[] = numberMatches.slice(0, 10).map((val) => ({
    name: 'numeric_value',
    type: 'number',
    value: val,
  }));

  // Extract sentences as facts
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 30).slice(0, 5);
  const facts = sentences.map((s) => s.trim());

  return {
    url,
    title,
    entities,
    facts,
    tables,
    wordCount,
    extractedAt: new Date().toISOString(),
  };
}
