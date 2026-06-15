// Target-URL guard contract tests (2026-06-15 security hardening).
//
// Locks the accept/reject matrix for validateTargetUrl — the gate in
// front of the SSRF-capable captureSite() and the scan/console
// stores. DNS-resolved checks (resolvesToPublicHost) need a network
// and are out of scope here.

import { describe, expect, it } from 'vitest';
import { validateTargetUrl, hostIsSafe } from '../services/url_guard';

describe('validateTargetUrl — accepts public targets', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['https://example.com', 'https://example.com/'],
    ['http://example.com/path?q=1', 'http://example.com/path?q=1'],
    ['sub.example.co.kr', 'https://sub.example.co.kr/'],
    ['EXAMPLE.COM', 'https://example.com/'],
    ['xn--3e0b707e.com', 'https://xn--3e0b707e.com/'], // punycode (한국.com)
    ['example.com:8443/app', 'https://example.com:8443/app'],
  ])('accepts %s', (input, normalized) => {
    const r = validateTargetUrl(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe(normalized);
  });
});

describe('validateTargetUrl — rejects hostile / non-public', () => {
  it.each([
    ['', 'empty'],
    ['javascript:alert(1)', 'bad_scheme'],
    ['JavaScript:alert(document.cookie)', 'bad_scheme'],
    ['data:text/html,<script>alert(1)</script>', 'bad_chars'], // angle brackets caught first
    ['data:text/plain,hi', 'bad_scheme'],
    ['file:///etc/passwd', 'bad_scheme'],
    ['vbscript:msgbox(1)', 'bad_scheme'],
    ['ftp://example.com/x', 'bad_scheme'],
    ['ws://example.com', 'bad_scheme'],
    ['gopher://example.com', 'bad_scheme'],
    ['http://example.com/<script>', 'bad_chars'],
    ['http://exam ple.com', 'bad_chars'],
    ['http://localhost', 'private_host'],
    ['localhost', 'private_host'],
    ['http://localhost:4100/api', 'private_host'],
    ['http://127.0.0.1/', 'private_host'],
    ['http://127.1/', 'private_host'], // 2-octet coercion
    ['http://10.0.0.5/', 'private_host'],
    ['http://172.16.0.1/', 'private_host'],
    ['http://192.168.1.1/', 'private_host'],
    ['http://169.254.169.254/latest/meta-data/', 'private_host'], // cloud metadata
    ['http://100.64.0.1/', 'private_host'], // CGNAT
    ['http://0.0.0.0/', 'private_host'],
    ['http://2130706433/', 'private_host'], // decimal 127.0.0.1
    ['http://0x7f000001/', 'private_host'], // hex 127.0.0.1
    ['http://[::1]/', 'private_host'], // IPv6 loopback
    ['http://db/', 'private_host'], // single-label internal
    ['http://metadata.internal/', 'private_host'], // reserved suffix
    ['http://printer.local/', 'private_host'], // mDNS
    ['http://user:pass@example.com/', 'has_credentials'],
    // userinfo SSRF-bypass attempt — caught by the credentials guard
    // (which runs before the host check); still rejected either way.
    ['http://evil.com@127.0.0.1/', 'has_credentials'],
  ])('rejects %s → %s', (input, reason) => {
    const r = validateTargetUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });
});

describe('hostIsSafe — IP classification', () => {
  it('passes public IPs', () => {
    expect(hostIsSafe('8.8.8.8')).toBe(true);
    expect(hostIsSafe('1.1.1.1')).toBe(true);
  });
  it('blocks the private/reserved ranges', () => {
    for (const ip of [
      '127.0.0.1', '10.255.255.255', '172.31.0.1', '192.168.0.1',
      '169.254.169.254', '0.0.0.0', '224.0.0.1', '255.255.255.255',
      '::1', 'fe80::1', 'fc00::1',
    ]) {
      expect(hostIsSafe(ip)).toBe(false);
    }
  });
});
