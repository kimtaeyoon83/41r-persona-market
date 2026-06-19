import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/anthropic_client.js', () => {
  const mockCreate = vi.fn();
  return {
    client: { messages: { create: mockCreate } },
    withRoute: <T>(_route: string, fn: () => Promise<T>) => fn(),
    extractTextContent: (msg: { content: Array<{ type: string; text?: string }> }) =>
      msg.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
    __mockCreate: mockCreate,
  };
});

import * as anth from '../services/anthropic_client.js';
import {
  ch1RelevanceFactor,
  nodeRelevance,
  judgeContentRelevance,
} from '../services/behavior_sim/relevance.js';

const mockCreate = (anth as unknown as { __mockCreate: ReturnType<typeof vi.fn> }).__mockCreate;
const reply = (text: string) => ({ content: [{ type: 'text', text }] });

describe('ch1RelevanceFactor (structural, pure)', () => {
  it('login walls yield 0, detail pages 1.0, listings 0.25', () => {
    expect(ch1RelevanceFactor({ id: 'home', login_wall: true })).toBe(0);
    expect(ch1RelevanceFactor({ id: 'product_1' })).toBe(1.0);
    expect(ch1RelevanceFactor({ id: 'py_detail' })).toBe(1.0);
    expect(ch1RelevanceFactor({ id: 'minwon_services' })).toBe(0.25);
  });
});

describe('nodeRelevance = ch1 × ch2 (pure)', () => {
  it('applies the structural factor to the content score', () => {
    expect(nodeRelevance({ id: 'product_1' }, 0.8)).toBeCloseTo(0.8, 6);
    expect(nodeRelevance({ id: 'minwon_services' }, 0.8)).toBeCloseTo(0.2, 6);
    expect(nodeRelevance({ id: 'home', login_wall: true }, 1.0)).toBe(0);
    expect(nodeRelevance({ id: 'x' }, 5)).toBeCloseTo(0.25, 6); // ch2 clamped to 1
  });
});

describe('judgeContentRelevance (ch2, LLM)', () => {
  beforeEach(() => mockCreate.mockReset());

  it('parses + clamps the LLM relevance', async () => {
    mockCreate.mockResolvedValue(reply('{"relevance": 0.7}'));
    expect(await judgeContentRelevance({ need: 'n', imageB64: 'x' })).toBeCloseTo(0.7, 6);
  });

  it('returns 0 on an unparseable response', async () => {
    mockCreate.mockResolvedValue(reply('not json'));
    expect(await judgeContentRelevance({ need: 'n', imageB64: 'x' })).toBe(0);
  });

  it('clamps out-of-range relevance to [0,1]', async () => {
    mockCreate.mockResolvedValue(reply('{"relevance": 1.8}'));
    expect(await judgeContentRelevance({ need: 'n', imageB64: 'x' })).toBe(1);
    mockCreate.mockResolvedValue(reply('{"relevance": -0.5}'));
    expect(await judgeContentRelevance({ need: 'n', imageB64: 'x' })).toBe(0);
  });
});
