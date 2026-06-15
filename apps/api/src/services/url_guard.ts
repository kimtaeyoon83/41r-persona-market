// Target-URL guard (2026-06-15 security hardening).
//
// The site URL a user submits for analysis is hostile input: it is
// (a) navigated to by a headless Chromium in captureSite() — an SSRF
// vector straight at cloud metadata / internal services — and
// (b) stored + echoed into the report.md export and persona prompts.
//
// validateTargetUrl() is the synchronous gate: scheme must be
// http(s); no credentials; no control/script chars; the host must be
// a public DNS hostname or a public IP literal — every private,
// loopback, link-local (incl. 169.254.169.254 metadata), ULA,
// CGNAT, multicast, and numeric/hex IP-coercion form is rejected.
//
// resolvesToPublicHost() is the async defense-in-depth used right
// before navigation: it resolves the hostname and refuses if ANY
// answer is a private IP (DNS-rebinding / internal-CNAME defense),
// which the static check can't catch.

import net from 'node:net';
import dns from 'node:dns';

const MAX_URL_LEN = 2000;

// Raw chars that have no place in a user-typed URL and signal an
// injection attempt (control chars, whitespace, angle/quote/backtick,
// shell/markup metacharacters). Percent-encoded forms (%3C) are fine
// and pass through.
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\x00-\x20<>"'`\\^{}|]/;

// Pseudo-schemes to reject outright (some have no "//" so the
// protocol check below wouldn't catch them after normalization).
const BAD_SCHEME = /^(javascript|data|vbscript|file|blob|about|ftp|ws|wss|gopher):/i;

export type UrlRejectReason =
  | 'empty'
  | 'too_long'
  | 'bad_chars'
  | 'bad_scheme'
  | 'unparseable'
  | 'has_credentials'
  | 'not_a_hostname'
  | 'private_host';

export type UrlGuardResult =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: UrlRejectReason };

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24 IETF protocol
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return false;
}

function isPrivateIPv6(raw: string): boolean {
  const x = raw.toLowerCase().replace(/^\[|\]$/g, '');
  if (x === '::1' || x === '::') return true; // loopback + unspecified
  if (x.startsWith('fe80') || x.startsWith('fc') || x.startsWith('fd')) return true; // link-local + ULA
  const mapped = x.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && mapped[1]) return isPrivateIPv4(mapped[1]); // IPv4-mapped
  return false;
}

/** True when the host is a public hostname or public IP literal.
 *  Rejects private/reserved IPs, loopback names, reserved suffixes,
 *  single-label hosts, and numeric/hex forms browsers coerce to IPs. */
export function hostIsSafe(host: string): boolean {
  const h = host.toLowerCase();
  if (net.isIP(h) === 4) return !isPrivateIPv4(h);
  if (net.isIP(h) === 6) return !isPrivateIPv6(h);

  // Numeric / hex / octal forms that curl & browsers coerce to IPs
  // (2130706433 → 127.0.0.1, 0x7f000001, 127.1) but net.isIP rejects.
  if (/^[\d.]+$/.test(h) || /^0x[\da-f]+$/i.test(h) || /^\d+$/.test(h)) return false;

  if (!h.includes('.')) return false; // single-label (localhost, db, metadata)
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) {
    return false; // reserved / mDNS / intranet suffixes — never public
  }
  if (!/^[a-z0-9._-]+$/.test(h)) return false; // punycode/ASCII labels only
  return true;
}

export function validateTargetUrl(raw: string): UrlGuardResult {
  const s = (raw ?? '').trim();
  if (!s) return { ok: false, reason: 'empty' };
  if (s.length > MAX_URL_LEN) return { ok: false, reason: 'too_long' };
  if (BAD_CHARS.test(s)) return { ok: false, reason: 'bad_chars' };
  if (BAD_SCHEME.test(s)) return { ok: false, reason: 'bad_scheme' };

  // Accept bare hosts ("example.com") by assuming https — same
  // contract captureSite always used. Anything already carrying an
  // http(s) scheme is parsed as-is.
  const candidate = /^https?:\/\//i.test(s) ? s : `https://${s}`;

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'bad_scheme' };
  }
  if (u.username || u.password) return { ok: false, reason: 'has_credentials' };
  if (!u.hostname) return { ok: false, reason: 'not_a_hostname' };
  if (!hostIsSafe(u.hostname)) return { ok: false, reason: 'private_host' };

  return { ok: true, url: u.toString(), host: u.hostname };
}

/**
 * Defense-in-depth before an actual navigation: resolve the hostname
 * and refuse if any answer is private. Catches DNS rebinding and
 * internal CNAMEs (attacker.com → 10.0.0.5) that the static check
 * cannot see. IP literals are re-checked statically. Unresolvable →
 * unsafe (don't navigate).
 */
export async function resolvesToPublicHost(host: string): Promise<boolean> {
  if (net.isIP(host)) return hostIsSafe(host);
  try {
    const addrs = await dns.promises.lookup(host, { all: true });
    if (addrs.length === 0) return false;
    return addrs.every((a) =>
      a.family === 4 ? !isPrivateIPv4(a.address) : !isPrivateIPv6(a.address),
    );
  } catch {
    return false;
  }
}
