import { extractKeywords } from './llm.js';
import type { PersonaVector } from '@41rpm/shared';

interface PersonaWithMeta {
  id: string;
  testerAddr: string;
  vector: PersonaVector;
  qualityScore?: number;
}

interface MatchResult {
  persona: PersonaWithMeta;
  score: number;
  matchedKeywords: string[];
}

// Map keywords to expertise fields
const keywordToExpertise: Record<string, keyof PersonaVector['expertise']> = {
  defi: 'defi', swap: 'defi', dex: 'defi', lending: 'defi', yield: 'defi', liquidity: 'defi', staking: 'defi',
  nft: 'nft', collectible: 'nft', marketplace: 'nft', mint: 'nft',
  game: 'gaming', gaming: 'gaming', play: 'gaming',
  ai: 'ai_tools', llm: 'ai_tools', chatbot: 'ai_tools', machine: 'ai_tools',
  web: 'general_web', website: 'general_web', app: 'general_web', dashboard: 'general_web', saas: 'general_web',
};

function computeExpertiseScore(keywords: string[], vector: PersonaVector): { score: number; matched: string[] } {
  const matched: string[] = [];
  let totalScore = 0;
  let count = 0;

  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    for (const [pattern, field] of Object.entries(keywordToExpertise)) {
      if (lower.includes(pattern)) {
        totalScore += vector.expertise[field];
        matched.push(`${kw} -> ${field}`);
        count++;
        break;
      }
    }
  }

  // If no keywords matched, use general_web as default
  if (count === 0) {
    return { score: vector.expertise.general_web * 0.5, matched: ['default: general_web'] };
  }

  return { score: totalScore / count, matched };
}

export async function matchPersonas(
  testDescription: string,
  targetUrl: string,
  personas: PersonaWithMeta[],
  maxResults: number = 5,
): Promise<MatchResult[]> {
  // Extract keywords from test description and URL
  let keywords: string[];
  try {
    keywords = await extractKeywords(`${testDescription} ${targetUrl}`);
  } catch {
    // Fallback: simple word extraction
    keywords = testDescription.split(/\s+/).filter(w => w.length > 3);
  }

  // Score each persona
  const results: MatchResult[] = personas.map(persona => {
    const { score: expertiseScore, matched } = computeExpertiseScore(keywords, persona.vector);

    // Weighted score: 50% expertise match + 30% quality + 20% reliability
    const qualityWeight = persona.vector.reliability.quality_score;
    const consistencyWeight = persona.vector.reliability.consistency;

    const totalScore = (expertiseScore * 0.5) + (qualityWeight * 0.3) + (consistencyWeight * 0.2);

    return {
      persona,
      score: Math.round(totalScore * 100) / 100,
      matchedKeywords: matched,
    };
  });

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, maxResults);
}
