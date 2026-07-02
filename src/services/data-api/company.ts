import { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getRedisClient } from '../../utils/redis';
import { logger } from '../../middleware/logger';
import { validateUrl, SsrfError } from '../../utils/ssrf-guard';

const CACHE_TTL = 86400; // 24 hours

interface CompanyProfile {
  domain: string;
  name: string;
  description: string;
  industry: string;
  employeeCount: string;
  founded: string;
  location: string;
  socialLinks: Record<string, string>;
  techStack: string[];
  cachedAt: string;
}

export async function companyHandler(req: Request, res: Response): Promise<void> {
  const domain = ((req.params['domain'] as string) ?? '').toLowerCase().trim();

  if (!domain || !/^[a-z0-9.-]{3,100}$/.test(domain)) {
    res.status(400).json({ error: 'Invalid domain name' });
    return;
  }

  const cacheKey = `company:${domain}`;
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
    const result = await fetchCompanyProfile(domain);

    if (redis) {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result)).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    logger.error('Company profile fetch failed', { domain, err });
    res.status(502).json({ error: 'Failed to fetch company profile', domain });
  }
}

async function fetchCompanyProfile(domain: string): Promise<CompanyProfile> {
  const profile: CompanyProfile = {
    domain,
    name: '',
    description: '',
    industry: '',
    employeeCount: 'Unknown',
    founded: 'Unknown',
    location: 'Unknown',
    socialLinks: {},
    techStack: [],
    cachedAt: new Date().toISOString(),
  };

  // Try Clearbit free tier
  const clearbitKey = process.env.CLEARBIT_API_KEY;
  if (clearbitKey && clearbitKey !== 'your_clearbit_key') {
    try {
      const resp = await axios.get(`https://company.clearbit.com/v2/companies/find`, {
        params: { domain },
        headers: { Authorization: `Bearer ${clearbitKey}` },
        timeout: 8000,
      });
      const data = resp.data as ClearbitCompany;
      return mapClearbitToProfile(domain, data);
    } catch (err) {
      logger.warn('Clearbit API failed, falling back to scrape', { domain, err });
    }
  }

  // Fallback: scrape company website
  return scrapeCompanyWebsite(domain, profile);
}

interface ClearbitCompany {
  name?: string;
  description?: string;
  category?: { industry?: string };
  metrics?: { employees?: number; employeesRange?: string };
  foundedYear?: number;
  geo?: { city?: string; country?: string };
  twitter?: { handle?: string };
  linkedin?: { handle?: string };
  facebook?: { handle?: string };
  tech?: string[];
}

function mapClearbitToProfile(domain: string, data: ClearbitCompany): CompanyProfile {
  return {
    domain,
    name: data.name ?? domain,
    description: data.description ?? '',
    industry: data.category?.industry ?? 'Unknown',
    employeeCount: data.metrics?.employeesRange ?? String(data.metrics?.employees ?? 'Unknown'),
    founded: data.foundedYear ? String(data.foundedYear) : 'Unknown',
    location: [data.geo?.city, data.geo?.country].filter(Boolean).join(', ') || 'Unknown',
    socialLinks: {
      ...(data.twitter?.handle ? { twitter: `https://twitter.com/${data.twitter.handle}` } : {}),
      ...(data.linkedin?.handle ? { linkedin: `https://linkedin.com/company/${data.linkedin.handle}` } : {}),
      ...(data.facebook?.handle ? { facebook: `https://facebook.com/${data.facebook.handle}` } : {}),
    },
    techStack: data.tech ?? [],
    cachedAt: new Date().toISOString(),
  };
}

async function scrapeCompanyWebsite(domain: string, profile: CompanyProfile): Promise<CompanyProfile> {
  try {
    const url = `https://${domain}`;
    await validateUrl(url);

    const resp = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AgentBot/1.0)',
        Accept: 'text/html',
      },
      maxRedirects: 3,
    });

    const $ = cheerio.load(resp.data as string);

    profile.name =
      $('meta[property="og:site_name"]').attr('content') ??
      $('title').text().split(/[|\-–]/)[0].trim() ??
      domain;

    profile.description =
      $('meta[name="description"]').attr('content') ??
      $('meta[property="og:description"]').attr('content') ??
      '';

    // Extract social links
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (href.includes('twitter.com') || href.includes('x.com')) {
        profile.socialLinks.twitter = href;
      } else if (href.includes('linkedin.com')) {
        profile.socialLinks.linkedin = href;
      } else if (href.includes('github.com')) {
        profile.socialLinks.github = href;
      }
    });
  } catch (err) {
    logger.warn('Website scrape failed', { domain, err });
    profile.name = domain;
  }

  return profile;
}
