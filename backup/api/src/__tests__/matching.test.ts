import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PersonaVector } from '@41rpm/shared';

// Mock the LLM service to avoid real API calls
vi.mock('../services/llm.js', () => ({
  extractKeywords: vi.fn(),
  extractJson: vi.fn((t: string) => t),
}));

import { matchPersonas } from '../services/matching.js';
import { extractKeywords } from '../services/llm.js';

const mockedExtractKeywords = vi.mocked(extractKeywords);

function makePersona(overrides: Partial<PersonaVector> = {}): PersonaVector {
  return {
    test_style: { thoroughness: 0.7, speed: 0.6, ux_focus: 0.8, bug_detection: 0.5, creativity: 0.6 },
    expertise: { defi: 0.5, nft: 0.3, gaming: 0.2, ai_tools: 0.4, general_web: 0.7 },
    feedback_pattern: { ui_critical: 0.7, security_aware: 0.5, performance_sensitive: 0.6, accessibility_focus: 0.4, detail_oriented: 0.7 },
    reliability: { quality_score: 0.7, consistency: 0.8, response_rate: 1.0 },
    voice_sample: 'Test voice',
    ...overrides,
  };
}

function makePersonaWithMeta(id: string, overrides: Partial<PersonaVector> = {}) {
  return {
    id,
    testerAddr: `wallet_${id}`,
    vector: makePersona(overrides),
  };
}

describe('matchPersonas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ranks DeFi expert higher for DeFi-related test', async () => {
    mockedExtractKeywords.mockResolvedValue(['defi', 'swap', 'liquidity']);

    const defiExpert = makePersonaWithMeta('defi', {
      expertise: { defi: 0.9, nft: 0.1, gaming: 0.1, ai_tools: 0.2, general_web: 0.5 },
      reliability: { quality_score: 0.8, consistency: 0.8, response_rate: 1.0 },
    });
    const nftExpert = makePersonaWithMeta('nft', {
      expertise: { defi: 0.1, nft: 0.9, gaming: 0.1, ai_tools: 0.2, general_web: 0.5 },
      reliability: { quality_score: 0.8, consistency: 0.8, response_rate: 1.0 },
    });

    const results = await matchPersonas('Test a DeFi swap platform', 'https://jup.ag', [defiExpert, nftExpert]);

    expect(results).toHaveLength(2);
    expect(results[0].persona.id).toBe('defi');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('uses general_web fallback when no keywords match', async () => {
    mockedExtractKeywords.mockResolvedValue(['xyz', 'abc']);

    const persona = makePersonaWithMeta('p1', {
      expertise: { defi: 0.1, nft: 0.1, gaming: 0.1, ai_tools: 0.1, general_web: 0.9 },
    });

    const results = await matchPersonas('Unknown domain test', 'https://example.com', [persona]);

    expect(results).toHaveLength(1);
    expect(results[0].matchedKeywords).toContain('default: general_web');
  });

  it('factors in reliability scores', async () => {
    mockedExtractKeywords.mockResolvedValue(['web', 'dashboard']);

    const highQuality = makePersonaWithMeta('hq', {
      expertise: { defi: 0.5, nft: 0.5, gaming: 0.5, ai_tools: 0.5, general_web: 0.5 },
      reliability: { quality_score: 0.95, consistency: 0.95, response_rate: 1.0 },
    });
    const lowQuality = makePersonaWithMeta('lq', {
      expertise: { defi: 0.5, nft: 0.5, gaming: 0.5, ai_tools: 0.5, general_web: 0.5 },
      reliability: { quality_score: 0.2, consistency: 0.2, response_rate: 1.0 },
    });

    const results = await matchPersonas('Test dashboard', 'https://example.com', [lowQuality, highQuality]);

    expect(results[0].persona.id).toBe('hq');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('limits results to maxResults', async () => {
    mockedExtractKeywords.mockResolvedValue(['web']);

    const personas = Array.from({ length: 10 }, (_, i) => makePersonaWithMeta(`p${i}`));

    const results = await matchPersonas('Test web app', 'https://example.com', personas, 3);

    expect(results).toHaveLength(3);
  });

  it('falls back to simple word extraction when LLM fails', async () => {
    mockedExtractKeywords.mockRejectedValue(new Error('API error'));

    const defiExpert = makePersonaWithMeta('defi', {
      expertise: { defi: 0.9, nft: 0.1, gaming: 0.1, ai_tools: 0.2, general_web: 0.5 },
    });

    // "swap" from description will match defi keyword
    const results = await matchPersonas('Test the swap interface', 'https://example.com', [defiExpert]);

    expect(results).toHaveLength(1);
    // Should still return results even with LLM failure
    expect(results[0].persona.id).toBe('defi');
  });

  it('matches NFT keywords correctly', async () => {
    mockedExtractKeywords.mockResolvedValue(['nft', 'collectible', 'marketplace']);

    const nftExpert = makePersonaWithMeta('nft', {
      expertise: { defi: 0.1, nft: 0.95, gaming: 0.1, ai_tools: 0.2, general_web: 0.5 },
      reliability: { quality_score: 0.8, consistency: 0.8, response_rate: 1.0 },
    });
    const generalTester = makePersonaWithMeta('gen', {
      expertise: { defi: 0.3, nft: 0.3, gaming: 0.3, ai_tools: 0.3, general_web: 0.8 },
      reliability: { quality_score: 0.8, consistency: 0.8, response_rate: 1.0 },
    });

    const results = await matchPersonas('Test NFT marketplace', 'https://magiceden.io', [generalTester, nftExpert]);

    expect(results[0].persona.id).toBe('nft');
  });
});
