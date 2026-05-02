// Contract tests for classifySite (Haiku vision wrapper).
// Locks: happy-path JSON parse, Zod schema validation rejecting
// out-of-range or missing fields, null-on-error fallback (caller
// uses the placeholder when classifier fails — must NOT throw),
// and the "empty screenshots → null" early exit so an unrelated
// pipeline crash never asks Anthropic for nothing.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { classifySite } from '../services/site_classifier.js';

vi.mock('../services/anthropic_client.js', () => {
  const mockCreate = vi.fn();
  return {
    client: { messages: { create: mockCreate } },
    withRoute: <T>(_route: string, fn: () => Promise<T>) => fn(),
    __mockCreate: mockCreate,
  };
});

import * as anth from '../services/anthropic_client.js';
const mockCreate = (anth as unknown as { __mockCreate: ReturnType<typeof vi.fn> }).__mockCreate;

const URL = 'https://example.com';
const VALID_SCREENSHOT = 'https://cdn.example.com/cap.png';

function mockText(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 30 },
  });
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe('classifySite', () => {
  it('returns parsed classification on a well-formed Haiku reply', async () => {
    mockText(
      JSON.stringify({
        category: 'DeFi',
        category_confidence: 0.92,
        one_line_pitch: 'Decentralised swap aggregator with MEV protection.',
      }),
    );
    const out = await classifySite(URL, [VALID_SCREENSHOT]);
    expect(out).not.toBeNull();
    expect(out!.category).toBe('DeFi');
    expect(out!.category_confidence).toBe(0.92);
    expect(out!.one_line_pitch).toMatch(/swap aggregator/);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns null when Haiku replies with an invalid category', async () => {
    mockText(
      JSON.stringify({
        category: 'NotARealCategory',
        category_confidence: 0.5,
        one_line_pitch: 'Some pitch text.',
      }),
    );
    const out = await classifySite(URL, [VALID_SCREENSHOT]);
    expect(out).toBeNull();
  });

  it('returns null when category_confidence is out of range', async () => {
    mockText(
      JSON.stringify({
        category: 'DeFi',
        category_confidence: 1.4, // > 1 — schema rejects
        one_line_pitch: 'Pitch.',
      }),
    );
    const out = await classifySite(URL, [VALID_SCREENSHOT]);
    expect(out).toBeNull();
  });

  it('returns null when Haiku reply is unparseable JSON (does not throw)', async () => {
    mockText('not even close to JSON');
    const out = await classifySite(URL, [VALID_SCREENSHOT]);
    expect(out).toBeNull();
  });

  it('returns null on Anthropic API failure (does not throw)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('upstream 429'));
    const out = await classifySite(URL, [VALID_SCREENSHOT]);
    expect(out).toBeNull();
  });

  it('returns null without calling Haiku when no screenshots passed', async () => {
    const out = await classifySite(URL, []);
    expect(out).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null when local screenshot path is not readable', async () => {
    // A non-http URL that doesn't exist on disk → buildImageBlock
    // returns null → classifySite skips the LLM call entirely.
    const out = await classifySite(URL, ['/site-captures/does-not-exist.png']);
    expect(out).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
