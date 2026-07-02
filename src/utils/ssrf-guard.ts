import { LookupAddress } from 'dns';
import { promisify } from 'util';
import axios, { AxiosResponse } from 'axios';
import { logger } from '../middleware/logger';

const dnsResolve = promisify(require('dns').resolve4);

const BLOCKED_HOSTS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  'metadata.google.internal',
  'metadata',
  '0.0.0.0',
]);

const PRIVATE_RANGES: Array<(ip: string) => boolean> = [
  (ip) => ip === '127.0.0.1',
  (ip) => ip.startsWith('10.'),
  (ip) => ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') ||
        ip.startsWith('172.19.') || ip.startsWith('172.20.') || ip.startsWith('172.21.') ||
        ip.startsWith('172.22.') || ip.startsWith('172.23.') || ip.startsWith('172.24.') ||
        ip.startsWith('172.25.') || ip.startsWith('172.26.') || ip.startsWith('172.27.') ||
        ip.startsWith('172.28.') || ip.startsWith('172.29.') || ip.startsWith('172.30.') ||
        ip.startsWith('172.31.'),
  (ip) => ip.startsWith('192.168.'),
  (ip) => ip.startsWith('169.254.'),
  (ip) => ip.startsWith('::1') || ip === '::',
  (ip) => ip.startsWith('fc') || ip.startsWith('fd'),
  (ip) => ip.startsWith('fe80:'),
];

export interface SafeFetchOptions {
  timeout?: number;
  maxRedirects?: number;
  responseType?: 'arraybuffer' | 'text' | 'json';
  headers?: Record<string, string>;
  validateStatus?: (status: number) => boolean;
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export function isPrivateIP(ip: string): boolean {
  if (BLOCKED_HOSTS.has(ip)) return true;
  return PRIVATE_RANGES.some((check) => check(ip));
}

async function resolveAndCheck(hostname: string): Promise<void> {
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) {
    throw new SsrfError(`Blocked host: ${hostname}`);
  }

  let addresses: LookupAddress[] | string[];
  try {
    addresses = await dnsResolve(hostname);
  } catch {
    return;
  }

  for (const addr of addresses as string[]) {
    if (typeof addr === 'string' && isPrivateIP(addr)) {
      throw new SsrfError(`Blocked private/internal IP for host ${hostname}: ${addr}`);
    }
  }
}

export async function validateUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfError(`Blocked non-HTTP scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new SsrfError(`Blocked localhost: ${hostname}`);
  }

  await resolveAndCheck(hostname);

  return parsed;
}

export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<AxiosResponse> {
  const validated = await validateUrl(url);

  const resp = await axios.get(validated.toString(), {
    timeout: options.timeout ?? 15000,
    maxRedirects: options.maxRedirects ?? 3,
    responseType: options.responseType,
    headers: options.headers ?? { 'User-Agent': 'Mozilla/5.0 (compatible; AgentBot/1.0)' },
    validateStatus: options.validateStatus ?? ((status) => status < 400),
  });

  if (resp.request?.res?.responseUrl) {
    const finalUrl = new URL(resp.request.res.responseUrl);
    await resolveAndCheck(finalUrl.hostname.toLowerCase());
  }

  return resp;
}
