#!/usr/bin/env node
/**
 * is-listed — Check whether AiScale Agent Services endpoints are registered
 * in the x402 Bazaar (the Coinbase CDP discovery feed).
 *
 * Resources are NOT registered manually — the CDP facilitator auto-lists a
 * resource only after a real x402 payment settles for it. So an endpoint
 * missing from the feed means no real payment has ever settled against it.
 * Push one through with `npm run seed` to get listed.
 *
 * Usage:
 *   npm run is-listed                              # check PLATFORM_URL (default: agents.aiscale.pro)
 *   npm run is-listed -- --url https://other.host  # check a different deployment host
 *   npm run is-listed -- --any-host                # match by path, ignore the registered host
 *
 * Exits non-zero only if the discovery feed cannot be reached.
 */
import 'dotenv/config';
import { BAZAAR_DISCOVERY_URL } from '../config/network';
import { routeConfigs } from '../config/x402-bazaar-config';

// --- Args / config -----------------------------------------------------------

function readFlag(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const ANY_HOST = process.argv.includes('--any-host');
const BASE_URL = (readFlag('--url') ?? process.env.PLATFORM_URL ?? 'https://agents.aiscale.pro').replace(/\/+$/, '');
const BASE_ORIGIN = new URL(BASE_URL).origin.toLowerCase();

// --- Types -------------------------------------------------------------------

interface Accept {
  scheme?: string;
  amount?: string;
  network?: string;
  payTo?: string;
}

interface DiscoveryItem {
  resource: string;
  description?: string;
  quality?: unknown;
  lastUpdated?: string;
  accepts?: Accept[];
}

interface ParsedItem {
  origin: string;
  pathname: string;
  item: DiscoveryItem;
}

interface Expected {
  method: string;
  path: string;   // route template, e.g. "/api/v1/sentiment/:ticker"
  full: string;   // absolute template URL under BASE_URL
}

// Expected endpoints come from the single source of truth (routeConfigs).
// Keys look like "GET /api/v1/sentiment/:ticker".
const expected: Expected[] = Object.keys(routeConfigs).map((key) => {
  const space = key.indexOf(' ');
  const method = space >= 0 ? key.slice(0, space) : 'GET';
  const path = space >= 0 ? key.slice(space + 1) : key;
  return { method, path, full: `${BASE_URL}${path}` };
});

// --- Helpers -----------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchPage(offset: number, limit: number): Promise<{ items: DiscoveryItem[]; total: number }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BAZAAR_DISCOVERY_URL}?limit=${limit}&offset=${offset}`, {
      headers: { accept: 'application/json' },
    });
    if (res.ok) {
      const j = (await res.json()) as { items?: DiscoveryItem[]; pagination?: { total?: number } };
      return { items: j.items ?? [], total: j.pagination?.total ?? 0 };
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(800 * (attempt + 1)); // back off on rate-limit / transient 5xx
      continue;
    }
    throw new Error(`Discovery feed returned HTTP ${res.status}`);
  }
  throw new Error('Discovery feed rate-limited after retries');
}

/**
 * Does a discovered pathname match a route template? Handles both forms the
 * facilitator may register: the template itself ("/sentiment/:ticker") or a
 * concrete hit ("/sentiment/AAPL"). ":param" segments become [^/]+.
 */
function pathMatches(discoveredPath: string, template: string): boolean {
  if (discoveredPath === template) return true;
  const regex = new RegExp('^' + template.replace(/:[^/]+/g, '[^/]+') + '$');
  return regex.test(discoveredPath);
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const log = (s = ''): void => {
    process.stdout.write(s + '\n');
  };

  log('x402 Bazaar listing check');
  log(`Platform:   ${BASE_URL}${ANY_HOST ? '   (matching by path — host ignored)' : ''}`);
  log(`Discovery:  ${BAZAAR_DISCOVERY_URL}`);

  // Page through the entire discovery feed (limit/offset pagination).
  const parsed: ParsedItem[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total = 0;
  log('\nScanning discovery feed…');
  do {
    const { items, total: t } = await fetchPage(offset, 500);
    total = t;
    for (const it of items) {
      if (!it.resource || seen.has(it.resource)) continue;
      seen.add(it.resource);
      try {
        const u = new URL(it.resource);
        parsed.push({ origin: u.origin.toLowerCase(), pathname: u.pathname, item: it });
      } catch {
        /* skip malformed resource URLs */
      }
    }
    process.stdout.write(`\r  ${Math.min(offset + items.length, total)}/${total} resources scanned`);
    offset += items.length;
    if (!items.length) break;
    await sleep(120);
  } while (offset < total);
  process.stdout.write('\n');

  // Match each expected endpoint against the discovered resources.
  const listed: Array<{ exp: Expected; p: ParsedItem; hostNote?: string }> = [];
  const missing: Expected[] = [];

  for (const exp of expected) {
    const match = parsed.find(
      (p) => pathMatches(p.pathname, exp.path) && (ANY_HOST || p.origin === BASE_ORIGIN)
    );
    if (match) {
      const hostNote = !ANY_HOST || match.origin === BASE_ORIGIN ? undefined : `registered under ${match.origin}`;
      listed.push({ exp, p: match, hostNote });
    } else {
      missing.push(exp);
    }
  }

  // Report.
  log('');
  if (listed.length) {
    log(`✅ Listed (${listed.length}):`);
    for (const { exp, p, hostNote } of listed) {
      const a = p.item.accepts?.[0];
      log(`   • ${exp.method.padEnd(5)} ${exp.path}`);
      log(`       payTo=${a?.payTo ?? '?'}  network=${a?.network ?? '?'}  updated=${p.item.lastUpdated ?? '?'}${hostNote ? `  (${hostNote})` : ''}`);
    }
  }
  if (missing.length) {
    log(`\n❌ Not listed (${missing.length}):`);
    for (const exp of missing) log(`   • ${exp.method.padEnd(5)} ${exp.full}`);
    if (listed.length === 0) {
      log('\nNone of your endpoints are registered on the Bazaar.');
      log('Resources auto-register on the first real settled payment via the CDP');
      log('facilitator — push one through to list them:');
      log('   npm run seed');
    } else {
      log('\nSome endpoints are missing — re-run after each has settled a real payment.');
    }
  } else {
    log(`\nAll ${expected.length} endpoints are registered on the Bazaar. 🎉`);
  }

  log(`\nSummary: ${listed.length}/${expected.length} endpoints listed (scanned ${seen.size}/${total} resources in the feed).`);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
