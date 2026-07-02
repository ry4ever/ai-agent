import { describe, it, expect } from 'vitest';
import { validateUrl, isPrivateIP, SsrfError } from '../src/utils/ssrf-guard';

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
});
