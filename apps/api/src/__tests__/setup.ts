/**
 * Vitest setup — provides safe defaults for required env vars so the
 * Zod schema in config/env.ts validates cleanly during tests. Individual
 * tests can override via vi.resetModules + process.env mutation.
 */
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.NODE_ENV ??= 'test';
