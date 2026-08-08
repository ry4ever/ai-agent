import { describe, it, expect } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import axios from 'axios';
import { validateUrl, isPrivateIP, SsrfError, createSafeLookup } from '../src/utils/ssrf-guard';

describe('SSRF Guard', () => {
  describe('validateUrl', () => {
    it('accepts valid public HTTPS URLs', async () => {
      const url = await validateUrl('https://example.com/page');
      expect(url.hostname).toBe('example.com');
    });

    it('accepts valid public HTTP URLs', async () => {
      const url = await validateUrl('http://example.com');
      expect(url.protocol).toBe('http:');
    });

    it('rejects non-HTTP schemes', async () => {
      await expect(validateUrl('file:///etc/passwd')).rejects.toThrow(SsrfError);
      await expect(validateUrl('ftp://example.com')).rejects.toThrow(SsrfError);
    });

    it('rejects localhost', async () => {
      await expect(validateUrl('http://localhost:3000')).rejects.toThrow(SsrfError);
      await expect(validateUrl('http://foo.localhost')).rejects.toThrow(SsrfError);
    });

    // Node's http.request skips `lookup` for IP-literal hosts, so createSafeLookup
    // is never consulted for them. The pre-flight resolveAndCheck is therefore the
    // authoritative defence for IP literals — this pins that it catches them.
    it('rejects private IP literals', async () => {
      await expect(validateUrl('http://10.0.0.1/')).rejects.toThrow(SsrfError);
      await expect(validateUrl('http://192.168.1.1/')).rejects.toThrow(SsrfError);
      await expect(validateUrl('http://172.16.0.1/')).rejects.toThrow(SsrfError);
      await expect(validateUrl('http://127.0.0.1/')).rejects.toThrow(SsrfError);
    });

    it('rejects invalid URLs', async () => {
      await expect(validateUrl('not-a-url')).rejects.toThrow(SsrfError);
      await expect(validateUrl('')).rejects.toThrow(SsrfError);
    });
  });

  describe('isPrivateIP', () => {
    it('blocks loopback addresses', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true);
    });

    it('blocks RFC1918 private ranges', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('172.16.0.1')).toBe(true);
      expect(isPrivateIP('172.31.255.255')).toBe(true);
      expect(isPrivateIP('192.168.1.1')).toBe(true);
    });

    it('blocks link-local addresses', () => {
      expect(isPrivateIP('169.254.169.254')).toBe(true);
      expect(isPrivateIP('169.254.170.2')).toBe(true);
    });

    it('blocks IPv6 loopback', () => {
      expect(isPrivateIP('::1')).toBe(true);
    });

    it('allows public IPs', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('1.1.1.1')).toBe(false);
      expect(isPrivateIP('93.184.216.34')).toBe(false);
    });
  });

  describe('isPrivateIP — IPv4-mapped IPv6', () => {
    // Catches the ::ffff:169.254.169.254 metadata-bypass class.
    it('blocks IPv4-mapped private addresses', () => {
      expect(isPrivateIP('::ffff:169.254.169.254')).toBe(true);
      expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIP('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true);
    });

    it('still allows IPv4-mapped public addresses', () => {
      expect(isPrivateIP('::ffff:8.8.8.8')).toBe(false);
    });
  });

  describe('createSafeLookup', () => {
    // Deterministic rejection paths (checked before any DNS query).
    it('rejects localhost', async () => {
      const err = await new Promise<Error | null>((resolve) =>
        createSafeLookup()('localhost', {}, (e) => resolve(e))
      );
      expect(err).toBeInstanceOf(SsrfError);
    });

    it('rejects the cloud-metadata host', async () => {
      const err = await new Promise<Error | null>((resolve) =>
        createSafeLookup()('169.254.169.254', {}, (e) => resolve(e))
      );
      expect(err).toBeInstanceOf(SsrfError);
    });
  });

  describe('createSafeLookup — redirect-to-internal is blocked', () => {
    // The guard's central claim: axios hands `lookup` to follow-redirects, which
    // re-invokes it on every redirect hop, so a 302 to an internal host is
    // blocked — not just the initial URL. This exercises the real
    // axios → follow-redirects → lookup wiring against a local redirector.
    //
    // Targets must be HOSTNAMES, not IP literals: Node skips `lookup` for IP
    // literals, so a literal-IP redirect target would never reach the guard via
    // this path (literal IPs are instead caught pre-flight by resolveAndCheck —
    // see the 'rejects private IP literals' test). createSafeLookup blocks these
    // hosts before any resolution, so no DNS control is needed here.
    //
    // createSafeLookup also blocks the loopback the redirector sits on, so we
    // allow-list that single address to reach the first hop, then route the
    // redirect's target through the unmodified guard exactly as safeFetch does.
    const INTERNAL_TARGETS = [
      'localhost',              // loopback by name (host check)
      'metadata.google.internal', // GCP metadata host (blocklist, by name)
    ];

    function startRedirector(target: string): Promise<{ origin: string; close: () => Promise<void> }> {
      const server = http.createServer((_req, res) => {
        res.writeHead(302, { location: `http://${target}/` });
        res.end();
      });
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const port = (server.address() as AddressInfo).port;
          resolve({
            origin: `http://127.0.0.1:${port}`,
            close: () => new Promise((r) => server.close(() => r())),
          });
        });
      });
    }

    it.each(INTERNAL_TARGETS)('blocks a redirect to %s', async (target) => {
      const { origin, close } = await startRedirector(target);
      const resolved: string[] = [];

      const lookup = (
        hostname: string,
        options: object,
        cb: (err: Error | null, address?: unknown) => void
      ) => {
        resolved.push(hostname);
        // Allow only the in-test origin (loopback) so we can reach the
        // redirector; every other host — the redirect target — goes through the
        // real guard, unmodified.
        if (hostname === '127.0.0.1') {
          cb(null, { address: '127.0.0.1', family: 4 });
          return;
        }
        createSafeLookup()(hostname, options, cb as (err: Error | null, address: unknown) => void);
      };

      let err: unknown;
      try {
        await axios.get(origin, { lookup, maxRedirects: 5, timeout: 3000 } as object);
      } catch (e) {
        err = e;
      } finally {
        await close();
      }

      // (1) follow-redirects handed the redirect target to the lookup — it
      //     re-invokes lookup per hop. If an axios/follow-redirects bump broke
      //     this, `resolved` would only contain '127.0.0.1' and this fails loud.
      expect(resolved).toContain(target);

      // (2) the unmodified guard rejected the internal target before connecting.
      expect(
        isSsrfBlock(err),
        `expected redirect to ${target} to be blocked by the guard; got: ${describeErr(err)}`
      ).toBe(true);
    });

    function isSsrfBlock(err: unknown): boolean {
      // axios may surface the lookup error directly, wrapped as `.cause`, or with
      // the guard's message copied through — accept any of those.
      let cur: unknown = err;
      for (let i = 0; cur && i < 6; i++) {
        if (cur instanceof SsrfError) return true;
        if (cur instanceof Error && /Blocked host|private\/blocked/i.test(cur.message)) return true;
        cur = (cur as { cause?: unknown })?.cause;
      }
      return false;
    }

    function describeErr(err: unknown): string {
      if (!err) return String(err);
      const e = err as Error;
      return `${e?.constructor?.name}: ${e?.message ?? ''}`;
    }
  });
});
