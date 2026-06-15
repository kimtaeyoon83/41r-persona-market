// Client-side target-URL check (2026-06-15 security hardening).
//
// UX mirror of apps/api/src/services/url_guard.ts — gives instant
// inline feedback so a bad/hostile URL never even reaches POST
// /api/scan. The server stays authoritative (this is convenience, not
// the security boundary): it cannot do DNS resolution, and a crafted
// request can skip the browser entirely. Keep the two rule sets in
// sync when either changes.
//
// Returns a reason key the caller maps to an i18n message.

export type UrlCheckReason =
  | "empty"
  | "bad_chars"
  | "bad_scheme"
  | "unparseable"
  | "has_credentials"
  | "private_host";

export type UrlCheck =
  | { ok: true; normalized: string }
  | { ok: false; reason: UrlCheckReason };

// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\x00-\x20<>"'`\\^{}|]/;
const BAD_SCHEME = /^(javascript|data|vbscript|file|blob|about|ftp|ws|wss|gopher):/i;

function looksPrivate(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) {
    return true;
  }
  // literal IPv4 private/reserved ranges (best-effort; server does the
  // exhaustive + DNS-resolved check)
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (h === "::1" || h.startsWith("[")) return true; // bracketed IPv6 / loopback
  // numeric / hex coercion forms
  if (/^[\d.]+$/.test(h) || /^0x[\da-f]+$/i.test(h) || /^\d+$/.test(h)) return true;
  if (!h.includes(".")) return true; // single-label
  return false;
}

export function checkTargetUrl(raw: string): UrlCheck {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  if (BAD_CHARS.test(s)) return { ok: false, reason: "bad_chars" };
  if (BAD_SCHEME.test(s)) return { ok: false, reason: "bad_scheme" };

  const candidate = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "bad_scheme" };
  }
  if (u.username || u.password) return { ok: false, reason: "has_credentials" };
  if (!u.hostname || looksPrivate(u.hostname)) {
    return { ok: false, reason: "private_host" };
  }
  return { ok: true, normalized: u.toString() };
}
