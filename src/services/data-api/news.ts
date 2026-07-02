import { Request, Response } from 'express';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { getRedisClient } from '../../utils/redis';
import { logger } from '../../middleware/logger';

const CACHE_TTL = 3600; // 1 hour

interface NewsSummary {
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  relevance: number;
}

interface NewsResult {
  query: string;
  summaries: NewsSummary[];
  totalResults: number;
  generatedAt: string;
}

export async function newsHandler(req: Request, res: Response): Promise<void> {
  const query = ((req.query.q as string) ?? '').trim();

  if (!query || query.length < 2 || query.length > 200) {
    res.status(400).json({ error: 'Query parameter "q" is required (2-200 chars)' });
    return;
  }

  const cacheKey = `news:${query.toLowerCase().replace(/\s+/g, '_').slice(0, 80)}`;
  const redis = getRedisClient();

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.json(JSON.parse(cached));
        return;
      }
    } catch (err) {
      logger.warn('Redis cache miss (error)', { key: cacheKey, err });
    }
  }

  try {
    const result = await fetchAndSummarizeNews(query);

    if (redis) {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result)).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    logger.error('News fetch failed', { query, err });
    res.status(502).json({ error: 'Failed to fetch news', query });
  }
}

interface NewsAPIArticle {
  title?: string;
  description?: string;
  source?: { name?: string };
  url?: string;
  publishedAt?: string;
}

interface NewsAPIResponse {
  totalResults?: number;
  articles?: NewsAPIArticle[];
}

async function fetchAndSummarizeNews(query: string): Promise<NewsResult> {
  const newsApiKey = process.env.NEWS_API_KEY;
  let articles: NewsAPIArticle[] = [];

  if (newsApiKey && newsApiKey !== 'your_news_api_key') {
    try {
      const resp = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          q: query,
          apiKey: newsApiKey,
          pageSize: 10,
          sortBy: 'relevancy',
          language: 'en',
        },
        timeout: 8000,
      });
      const data = resp.data as NewsAPIResponse;
      articles = data.articles ?? [];
    } catch (err) {
      logger.warn('NewsAPI failed', { query, err });
    }
  }

  // Build summaries, using Claude if available for better quality
  const summaries = await buildSummaries(query, articles);

  return {
    query,
    summaries,
    totalResults: articles.length,
    generatedAt: new Date().toISOString(),
  };
}

async function buildSummaries(query: string, articles: NewsAPIArticle[]): Promise<NewsSummary[]> {
  if (articles.length === 0) {
    return [];
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Use Claude to generate better summaries if available
  if (anthropicKey && anthropicKey !== 'your_anthropic_api_key' && articles.length > 0) {
    try {
      const client = new Anthropic({ apiKey: anthropicKey, timeout: 15_000 });
      const articleText = articles
        .slice(0, 5)
        .map((a, i) => `${i + 1}. ${a.title ?? ''}: ${a.description ?? ''}`)
        .join('\n');

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Summarize these news articles about "${query}" in 1-2 sentences each. Return a JSON array with objects containing "index" (1-based) and "summary" fields only.\n\nArticles:\n${articleText}`,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const aiSummaries = JSON.parse(jsonMatch[0]) as Array<{ index: number; summary: string }>;
        return articles.slice(0, 5).map((article, i) => {
          const aiSummary = aiSummaries.find((s) => s.index === i + 1);
          return {
            title: article.title ?? '',
            summary: aiSummary?.summary ?? article.description ?? '',
            source: article.source?.name ?? '',
            url: article.url ?? '',
            publishedAt: article.publishedAt ?? '',
            relevance: 1 - i * 0.1,
          };
        });
      }
    } catch (err) {
      logger.warn('Claude summarization failed, using raw descriptions', { err });
    }
  }

  // Fallback: use raw descriptions
  return articles.slice(0, 5).map((article, i) => ({
    title: article.title ?? '',
    summary: article.description ?? '',
    source: article.source?.name ?? '',
    url: article.url ?? '',
    publishedAt: article.publishedAt ?? '',
    relevance: 1 - i * 0.1,
  }));
}
