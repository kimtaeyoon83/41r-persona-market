import { describe, it, expect } from 'vitest';
import { isOriginAllowed } from '../config/cors.js';

const allowlist = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'https://web-production-8813d.up.railway.app',
];

describe('isOriginAllowed', () => {
  it('allows requests with no Origin header (curl, server-to-server)', () => {
    expect(isOriginAllowed(undefined, allowlist)).toBe(true);
  });

  it('allows whitelisted origins', () => {
    expect(isOriginAllowed('http://localhost:3000', allowlist)).toBe(true);
    expect(isOriginAllowed('https://web-production-8813d.up.railway.app', allowlist)).toBe(true);
  });

  it('rejects unknown origins', () => {
    expect(isOriginAllowed('https://evil.example.com', allowlist)).toBe(false);
    expect(isOriginAllowed('http://localhost:9999', allowlist)).toBe(false);
  });

  it('is case-sensitive on scheme + host', () => {
    // Origins in the Origin header are canonicalized lowercase by browsers; an
    // exact match is the right default.
    expect(isOriginAllowed('HTTP://localhost:3000', allowlist)).toBe(false);
  });
});
