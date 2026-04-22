import { extractKeywords, parseJsonSafe, SCORING_MODELS } from './llm.js';
import { client, withRoute } from './anthropic_client.js';
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

// ── Keyword-based fallback (kept verbatim from pre-LLM era) ─────────
function rankByKeywords(
  personas: PersonaWithMeta[],
  keywords: string[],
): MatchResult[] {
  return personas
    .map((persona) => {
      const { score: expertiseScore, matched } = computeExpertiseScore(
        keywords,
        persona.vector,
      );
      const qualityWeight = persona.vector.reliability.quality_score;
      const consistencyWeight = persona.vector.reliability.consistency;
      const totalScore =
        expertiseScore * 0.5 + qualityWeight * 0.3 + consistencyWeight * 0.2;
      return {
        persona,
        score: Math.round(totalScore * 100) / 100,
        matchedKeywords: matched,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ── LLM ranker ──────────────────────────────────────────────────────

const RANK_SYSTEM = `당신은 "어떤 AI 페르소나가 이 제품 테스트에 가장 적합한가" 를 평가하는 매칭 큐레이터입니다.

각 페르소나의 **voice_sample** (성격·말투), **expertise** (전문 영역별 0~1 강도), **feedback_pattern** (피드백 편향), **demographics** (연령·기술 이해도) 을 고려해 제품의 target URL + 요구사항 / 테스트 목적에 가장 잘 맞는 페르소나를 고릅니다.

## 평가 기준
- voice_sample 의 톤·관심사가 제품 카테고리와 맞는지
- expertise 강도가 해당 도메인 (defi/nft/gaming/ai_tools/general_web) 에 부합하는지
- feedback_pattern 의 bias 가 테스트 요구사항과 결이 맞는지 (예: security 요구사항 → security_aware 높은 페르소나)
- quality_score·consistency 는 타이브레이커로만

## 출력 (JSON object, 코드펜스 없이)
{
  "ranked": [
    {"persona_id": "uuid 문자열 (입력으로 받은 id 그대로)", "score": 0.0~1.0, "reason": "1-2문장 한국어"}
  ]
}

## 규칙
- 정확히 top-N 개 (요청된 N) 만 반환. N 이 후보 수보다 크면 후보 수만큼.
- score 는 매칭 강도 (1.0 = 완벽, 0.5 = 보통). tie-break 에 reliability 사용.
- reason 은 persona 의 구체적 특징 언급 (voice 인용, expertise 숫자, 등).
- 입력에 없는 persona_id 를 만들지 마세요.
`;

async function rankByLLM(
  testDescription: string,
  targetUrl: string,
  personas: PersonaWithMeta[],
  maxResults: number,
): Promise<MatchResult[]> {
  const candidates = personas.map((p) => ({
    id: p.id,
    voice_sample: (p.vector.voice_sample || '').slice(0, 240),
    expertise: {
      defi: Number(p.vector.expertise.defi.toFixed(2)),
      nft: Number(p.vector.expertise.nft.toFixed(2)),
      gaming: Number(p.vector.expertise.gaming.toFixed(2)),
      ai_tools: Number(p.vector.expertise.ai_tools.toFixed(2)),
      general_web: Number(p.vector.expertise.general_web.toFixed(2)),
    },
    feedback_pattern: {
      ui_critical: Number(p.vector.feedback_pattern.ui_critical.toFixed(2)),
      security_aware: Number(p.vector.feedback_pattern.security_aware.toFixed(2)),
      performance_sensitive: Number(p.vector.feedback_pattern.performance_sensitive.toFixed(2)),
      accessibility_focus: Number(p.vector.feedback_pattern.accessibility_focus.toFixed(2)),
      detail_oriented: Number(p.vector.feedback_pattern.detail_oriented.toFixed(2)),
    },
    demographics: p.vector.demographics
      ? {
          age_group: p.vector.demographics.age_group,
          crypto_experience: Number(p.vector.demographics.crypto_experience?.toFixed(2) ?? 0),
          tech_literacy: Number(p.vector.demographics.tech_literacy?.toFixed(2) ?? 0),
        }
      : undefined,
    reliability: {
      quality_score: Number(p.vector.reliability.quality_score.toFixed(2)),
      consistency: Number(p.vector.reliability.consistency.toFixed(2)),
    },
  }));

  const userMsg =
    '## 대상 제품\n' +
    `URL: ${targetUrl}\n` +
    `테스트 요구사항: ${testDescription || '(일반 UX 평가)'}\n\n` +
    `## 페르소나 후보 (${candidates.length}명)\n` +
    JSON.stringify(candidates, null, 2) +
    '\n\n' +
    `위 후보 중 top-${Math.min(maxResults, candidates.length)} 을 고르세요.`;

  const resp = await withRoute('match_personas', () =>
    client.messages.create({
      model: SCORING_MODELS.haiku,
      max_tokens: 2000,
      temperature: 0.3,
      system: RANK_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    }),
  );

  const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
  const parsed = parseJsonSafe(raw) as { ranked?: Array<{ persona_id?: string; score?: number; reason?: string }> };
  const ranked = Array.isArray(parsed?.ranked) ? parsed.ranked : [];

  const byId = new Map(personas.map((p) => [p.id, p]));
  const results: MatchResult[] = [];
  for (const r of ranked) {
    const persona = byId.get(String(r?.persona_id ?? ''));
    if (!persona) continue; // LLM hallucinated an id — drop
    const score = typeof r.score === 'number' && Number.isFinite(r.score)
      ? Math.max(0, Math.min(1, r.score))
      : 0.5;
    const reason = String(r.reason ?? '').slice(0, 400);
    results.push({
      persona,
      score: Math.round(score * 100) / 100,
      matchedKeywords: reason ? [reason] : [], // repurpose field so callers surface reasoning
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

export async function matchPersonas(
  testDescription: string,
  targetUrl: string,
  personas: PersonaWithMeta[],
  maxResults: number = 5,
): Promise<MatchResult[]> {
  if (personas.length === 0) return [];

  // First try the LLM ranker — it reads voice_sample + feedback_pattern,
  // so it catches "this is a security-focused product → pick the
  // security-aware persona" even when the test description has no
  // recognisable keywords. Fall back to the keyword ranker on any
  // failure (no API key, rate-limited, malformed JSON, etc.) so the
  // auto-queue path always has something to work with.
  try {
    const llmResults = await rankByLLM(testDescription, targetUrl, personas, maxResults);
    if (llmResults.length > 0) return llmResults;
  } catch (err) {
    console.warn('[matchPersonas] LLM ranking failed, falling back to keyword:', err instanceof Error ? err.message : err);
  }

  let keywords: string[];
  try {
    keywords = await extractKeywords(`${testDescription} ${targetUrl}`);
  } catch {
    keywords = testDescription.split(/\s+/).filter((w) => w.length > 3);
  }
  return rankByKeywords(personas, keywords).slice(0, maxResults);
}
