/**
 * Unit tests for lib/api.ts.
 *
 * Focus: lock the contract that callers commonly trip over —
 *   1. request() preserves Content-Type when the caller passes its own
 *      headers (regression — earlier `...options` ordering wiped it,
 *      causing the API's JSON body parser to silently skip the body).
 *   2. signedRequest() does the nonce → sign → POST round-trip with
 *      x-wallet-address / x-nonce / x-signature headers.
 *   3. Error responses surface a useful Error.
 *
 * No DOM, no React — just the API helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_FETCH = globalThis.fetch;

interface FetchCall {
  url: string;
  init: RequestInit;
}

function captureFetch(responses: Array<unknown | Response>): {
  calls: FetchCall[];
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = responses[i++];
    if (r instanceof Response) return r;
    return new Response(JSON.stringify(r), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { calls, fetchMock };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('request()', () => {
  it('always sets Content-Type: application/json on outgoing requests', async () => {
    const { calls } = captureFetch([{ ok: true }]);
    const { testApi } = await import('./api');
    await testApi.list();
    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('throws with the server error message when response is not ok', async () => {
    const { fetchMock } = captureFetch([
      new Response(JSON.stringify({ error: 'wallet missing' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]);
    const { testApi } = await import('./api');
    await expect(testApi.list()).rejects.toThrow('wallet missing');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('falls back to status text when error body is not JSON', async () => {
    captureFetch([
      new Response('not-json', { status: 502, statusText: 'Bad Gateway' }),
    ]);
    const { testApi } = await import('./api');
    await expect(testApi.list()).rejects.toThrow('Bad Gateway');
  });
});

describe('signedRequest()', () => {
  it('fetches a nonce, signs it, then POSTs with auth headers', async () => {
    const wallet = 'WALLET_ABC';
    const nonce = 'NONCE_123';
    const signature = 'SIG_BASE58';
    const { calls } = captureFetch([
      { nonce, expiresAt: Date.now() + 60_000 },
      { ok: true, id: 'tester-1' },
    ]);
    const signMessage = vi.fn(async (msg: string) => {
      expect(msg).toBe(nonce);
      return signature;
    });

    const { testerApi } = await import('./api');
    const result = await testerApi.register(
      { wallet_address: wallet, display_name: 'Alice', profile: undefined },
      signMessage,
    );

    expect(result).toMatchObject({ ok: true });
    expect(signMessage).toHaveBeenCalledWith(nonce);
    expect(calls).toHaveLength(2);

    // Step 1: nonce request — GET, wallet in query
    expect(calls[0].url).toContain(`/api/auth/nonce?wallet=${encodeURIComponent(wallet)}`);

    // Step 2: signed POST — auth headers attached, Content-Type preserved
    const signedHeaders = calls[1].init.headers as Record<string, string>;
    expect(calls[1].init.method).toBe('POST');
    expect(signedHeaders['x-wallet-address']).toBe(wallet);
    expect(signedHeaders['x-nonce']).toBe(nonce);
    expect(signedHeaders['x-signature']).toBe(signature);
    expect(signedHeaders['Content-Type']).toBe('application/json');
    expect(typeof calls[1].init.body).toBe('string');
  });

  it('preserves Content-Type even when caller-supplied headers are present (regression)', async () => {
    // The bug this guards: spreading `...options` AFTER the headers object
    // wiped Content-Type, causing the API's express.json() parser to skip
    // the body and the server to receive an empty req.body.
    captureFetch([
      { nonce: 'N', expiresAt: Date.now() + 60_000 },
      { ok: true },
    ]);
    const signMessage = vi.fn(async () => 'sig');

    const { testApi } = await import('./api');
    await testApi.register(
      {
        target_url: 'https://example.com',
        budget_usdc: 10,
        reward_per_tester: 1,
        company_wallet: 'COMPANY_WALLET',
      },
      signMessage,
    );
    const headers = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[1][1].headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-wallet-address']).toBe('COMPANY_WALLET');
  });

  it('serializes body when supplied', async () => {
    captureFetch([
      { nonce: 'N', expiresAt: Date.now() + 60_000 },
      { ok: true },
    ]);
    const signMessage = vi.fn(async () => 'sig');
    const { testApi } = await import('./api');
    await testApi.retryAutotest(
      'test-id-1',
      { company_wallet: 'COMPANY' },
      signMessage,
    );
    const body = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[1][1].body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body)).toMatchObject({ company_wallet: 'COMPANY' });
  });
});
