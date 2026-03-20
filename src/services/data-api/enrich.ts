import { Request, Response } from 'express';
import axios from 'axios';
import { getRedisClient } from '../../utils/redis';
import { logger } from '../../middleware/logger';

const CACHE_TTL = 86400; // 24 hours

interface EmailEnrichment {
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  role: string;
  linkedinUrl: string;
  confidence: number;
  cachedAt: string;
}

export async function enrichHandler(req: Request, res: Response): Promise<void> {
  const email = (req.params.email ?? '').toLowerCase().trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  const cacheKey = `enrich:${email}`;
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
    const result = await enrichEmail(email);

    if (redis) {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result)).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    logger.error('Email enrichment failed', { email, err });
    res.status(502).json({ error: 'Failed to enrich email', email });
  }
}

async function enrichEmail(email: string): Promise<EmailEnrichment> {
  const hunterKey = process.env.HUNTER_API_KEY;

  // Hunter.io email enrichment
  if (hunterKey && hunterKey !== 'your_hunter_io_key') {
    try {
      const resp = await axios.get('https://api.hunter.io/v2/email-enrichment', {
        params: { email, api_key: hunterKey },
        timeout: 8000,
      });

      const data = resp.data as HunterEnrichmentResponse;
      if (data.data) {
        return mapHunterToEnrichment(email, data.data);
      }
    } catch (err) {
      logger.warn('Hunter.io API failed', { email, err });
    }
  }

  // Fallback: derive info from email domain
  return deriveFromEmail(email);
}

interface HunterEnrichmentData {
  first_name?: string;
  last_name?: string;
  position?: string;
  company?: string;
  linkedin?: string;
  confidence?: number;
}

interface HunterEnrichmentResponse {
  data?: HunterEnrichmentData;
}

function mapHunterToEnrichment(email: string, data: HunterEnrichmentData): EmailEnrichment {
  const firstName = data.first_name ?? '';
  const lastName = data.last_name ?? '';
  return {
    email,
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(' '),
    company: data.company ?? '',
    role: data.position ?? '',
    linkedinUrl: data.linkedin ?? '',
    confidence: data.confidence ?? 0,
    cachedAt: new Date().toISOString(),
  };
}

function deriveFromEmail(email: string): EmailEnrichment {
  const [localPart, domain] = email.split('@');
  const nameParts = localPart.split(/[._-]/);
  const firstName = nameParts[0] ? capitalize(nameParts[0]) : '';
  const lastName = nameParts[1] ? capitalize(nameParts[1]) : '';
  const company = domain.split('.')[0];

  return {
    email,
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(' '),
    company: capitalize(company),
    role: '',
    linkedinUrl: '',
    confidence: 20,
    cachedAt: new Date().toISOString(),
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
