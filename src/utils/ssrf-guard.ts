import { promisify } from 'util';
import axios, { AxiosResponse, LookupAddress } from 'axios';
import { logger } from '../middleware/logger';

const dns = require('dns');
const dnsResolve = promisify(dns.resolve4);
// dns.lookup (getaddrinfo) respects /etc/hosts and the system resolver; we use it
// with { all: true } to enumerate every address and keep only a public one.
const dnsLookupAll = promisify(dns.lookup) as (
  hostname: string,
  options: { all: true; family?: number }
) => Promise<Array<{ address: string; family: number | string }>>;

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
  // Defeat IPv4-mapped / IPv4-compatible IPv6 bypasses such as
  // ::ffff:169.254.169.254 — re-check the embedded IPv4 against the same rules.
  const v4 = ipv4FromV6(ip);
  if (v4 && (BLOCKED_HOSTS.has(v4) || PRIVATE_RANGES.some((check) => check(v4)))) {
    return true;
  }
  return PRIVATE_RANGES.some((check) => check(ip));
}

function ipv4FromV6(ip: string): string | null {
  const m = ip.toLowerCase().match(/^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  return m ? m[1] : null;
}

async function resolveAndCheck(hostname: string): Promise<void> {
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) {
    throw new SsrfError(`Blocked host: ${hostname}`);
  }

  let addresses: string[];
  try {
    addresses = await dnsResolve(hostname);
  } catch {
    return;
  }

  for (const addr of addresses) {
    if (isPrivateIP(addr)) {
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

/**
 * Node `lookup` implementation that pins each connection to a validated public IP.
 *
 * Passed to axios as the `lookup` option, which follow-redirects reuses on every
 * redirect hop — so intermediate redirects to internal hosts are blocked too.
 * A host that resolves only to private/blocked addresses (including IPv4-mapped
 * IPv6 such as ::ffff:169.254.169.254) is rejected. Because we resolve once and
 * force the request to connect to exactly the address we return, a second DNS
 * lookup can never flip to an internal IP — closing the DNS-rebinding TOCTOU
 * window that validate-then-fetch otherwise leaves open.
 */
type SafeLookupCallback = (
  err: Error | null,
  address: LookupAddress | LookupAddress[]
) => void;

export function createSafeLookup(): (
  hostname: string,
  options: object,
  cb: SafeLookupCallback
) => void {
  return (hostname, _options, cb) => {
    const host = hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || BLOCKED_HOSTS.has(host)) {
      cb(new SsrfError(`Blocked host: ${hostname}`), []);
      return;
    }

    dnsLookupAll(hostname, { all: true })
      .then((addresses) => {
        const safe = addresses.find((a) => !isPrivateIP(a.address));
        if (!safe) {
          cb(new SsrfError(`Host ${hostname} resolves only to private/blocked IPs`), []);
          return;
        }
        // family may come back as "IPv4"/"IPv6" depending on resolver; normalise
        // to the numeric form axios expects, derived from the address itself.
        cb(null, { address: safe.address, family: safe.address.includes(':') ? 6 : 4 });
      })
      .catch((err: NodeJS.ErrnoException) => {
        // NXDOMAIN, timeout, etc. — fail the request rather than proceed on an
        // ambiguous resolution state.
        cb(new SsrfError(`DNS resolution failed for ${hostname}: ${err.message}`), []);
      });
  };
}

export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<AxiosResponse> {
  // Early rejection for obviously-bad URLs (throws SsrfError, which handlers map
  // to 403). The authoritative defence is createSafeLookup below.
  const validated = await validateUrl(url);

  const resp = await axios.get(validated.toString(), {
    timeout: options.timeout ?? 15000,
    maxRedirects: options.maxRedirects ?? 3,
    responseType: options.responseType,
    headers: options.headers ?? { 'User-Agent': 'Mozilla/5.0 (compatible; AgentBot/1.0)' },
    validateStatus: options.validateStatus ?? ((status) => status < 400),
    lookup: createSafeLookup(),
  });

  return resp;
}
