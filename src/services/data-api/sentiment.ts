import { Request, Response } from 'express';
import axios from 'axios';
import { getRedisClient } from '../../utils/redis';
import { logger } from '../../middleware/logger';

const CACHE_TTL = 300; // 5 minutes

interface SentimentResult {
  ticker: string;
  score: number;
  label: 'bearish' | 'neutral' | 'bullish';
  volume: number;
  sources: number;
  cachedAt: string;
}

export async function sentimentHandler(req: Request, res: Response): Promise<void> {
  const ticker = ((req.params['ticker'] as string) ?? '').toUpperCase().trim();

  if (!ticker || !/^[A-Z0-9.]{1,10}$/.test(ticker)) {
    res.status(400).json({ error: 'Invalid ticker symbol' });
    return;
  }

  const cacheKey = `sentiment:${ticker}`;
  const redis = getRedisClient();

  // Check cache
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
    const result = await fetchSentiment(ticker);

    // Cache the result
    if (redis) {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result)).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    logger.error('Sentiment fetch failed', { ticker, err });
    res.status(502).json({ error: 'Failed to fetch sentiment data', ticker });
  }
}

async function fetchSentiment(ticker: string): Promise<SentimentResult> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  // Alpha Vantage News Sentiment API
  if (apiKey && apiKey !== 'your_alpha_vantage_key') {
    try {
      const resp = await axios.get('https://www.alphavantage.co/query', {
        params: {
          function: 'NEWS_SENTIMENT',
          tickers: ticker,
          apikey: apiKey,
          limit: 50,
        },
        timeout: 8000,
      });

      const data = resp.data as AlphaVantageNewsResponse;

      if (data.feed && data.feed.length > 0) {
        return parseAlphaVantageSentiment(ticker, data);
      }
    } catch (err) {
      logger.warn('Alpha Vantage API failed, using fallback', { ticker, err });
    }
  }

  // Fallback: scrape finviz
  return scrapeFinvizSentiment(ticker);
}

interface AlphaVantageNewsItem {
  ticker_sentiment?: Array<{
    ticker: string;
    ticker_sentiment_score: string;
    relevance_score: string;
  }>;
}

interface AlphaVantageNewsResponse {
  feed?: AlphaVantageNewsItem[];
  overall_sentiment_score?: number;
}

function parseAlphaVantageSentiment(
  ticker: string,
  data: AlphaVantageNewsResponse
): SentimentResult {
  const items = data.feed ?? [];
  let totalScore = 0;
  let count = 0;

  for (const item of items) {
    const tickerSentiment = item.ticker_sentiment?.find(
      (t) => t.ticker === ticker
    );
    if (tickerSentiment) {
      const score = parseFloat(tickerSentiment.ticker_sentiment_score);
      const relevance = parseFloat(tickerSentiment.relevance_score);
      if (!isNaN(score) && relevance > 0.1) {
        totalScore += score * relevance;
        count += relevance;
      }
    }
  }

  const avgScore = count > 0 ? totalScore / count : 0;
  const clampedScore = Math.max(-1, Math.min(1, avgScore));

  return {
    ticker,
    score: parseFloat(clampedScore.toFixed(4)),
    label: scoreToLabel(clampedScore),
    volume: items.length,
    sources: count,
    cachedAt: new Date().toISOString(),
  };
}

async function scrapeFinvizSentiment(ticker: string): Promise<SentimentResult> {
  try {
    const resp = await axios.get(`https://finviz.com/quote.ashx?t=${ticker}`, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AgentBot/1.0)',
      },
    });

    const html = resp.data as string;

    // Extract analyst ratings from finviz HTML
    const ratingMatch = html.match(/Recom[a-z]*.*?(\d+\.\d+)/i);
    if (ratingMatch) {
      // Finviz recommendation: 1=Strong Buy, 5=Strong Sell → convert to -1 to 1
      const rating = parseFloat(ratingMatch[1]);
      const score = ((3 - rating) / 2); // maps [1,5] → [1,-1]
      return {
        ticker,
        score: parseFloat(score.toFixed(4)),
        label: scoreToLabel(score),
        volume: 0,
        sources: 1,
        cachedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    logger.warn('Finviz scrape failed', { ticker, err });
  }

  // Last resort: neutral score
  return {
    ticker,
    score: 0,
    label: 'neutral',
    volume: 0,
    sources: 0,
    cachedAt: new Date().toISOString(),
  };
}

function scoreToLabel(score: number): 'bearish' | 'neutral' | 'bullish' {
  if (score > 0.15) return 'bullish';
  if (score < -0.15) return 'bearish';
  return 'neutral';
}
