/**
 * Persona → soul text builder.
 *
 * In upstream persona_agent the "soul" is a markdown file the LLM
 * ingests as a character sheet. This project stores personas as
 * (vector + tester profile) in Postgres, so we synthesise the
 * equivalent prose on demand. The shape matches what
 * questionnaire_generator.py's prompt expects to see under `## 페르소나`:
 * demographics first, then test style / expertise / feedback bias /
 * reliability, then a quoted voice sample.
 */
import type { InferSelectModel } from 'drizzle-orm';
import type { personas, testers } from '../../db/schema.js';

type PersonaRow = InferSelectModel<typeof personas>;
type TesterRow = InferSelectModel<typeof testers>;

function section(title: string, lines: string[]): string {
  const body = lines.filter(Boolean).join('\n');
  if (!body) return '';
  return `## ${title}\n${body}\n`;
}

function pct(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Math.max(0, Math.min(1, Number(n)));
  return `${Math.round(v * 100)}%`;
}

function describe<K extends string>(
  label: string,
  dims: Partial<Record<K, number>> | undefined | null,
  keys: readonly K[],
): string {
  if (!dims) return '';
  const parts = keys
    .map((k) => {
      const v = dims[k];
      if (v == null) return null;
      return `- ${String(k)}: ${pct(v)}`;
    })
    .filter((x): x is string => x !== null);
  return parts.length ? `**${label}**\n${parts.join('\n')}` : '';
}

export interface BuildSoulArgs {
  persona: Pick<PersonaRow, 'id' | 'vector'>;
  tester?: Pick<TesterRow, 'profile' | 'displayName'> | null;
}

/**
 * Build the soul text that gets injected under `## 페르소나` in the
 * questionnaire LLM's user message. Keep the layout stable — the
 * model is prompt-cached on this prefix across turns of the same
 * session.
 */
export function buildPersonaSoul(args: BuildSoulArgs): string {
  const v = args.persona.vector;
  const p = args.tester?.profile ?? null;

  // Demographics — pull from both persona.vector.demographics and
  // tester.profile so whichever side has the data contributes.
  const demoLines: string[] = [];
  if (p?.age_range) demoLines.push(`- 연령대: ${p.age_range}`);
  if (p?.occupation) demoLines.push(`- 직업: ${p.occupation}`);
  if (p?.region) demoLines.push(`- 지역: ${p.region}`);
  if (p?.crypto_experience) demoLines.push(`- 암호화폐 경험: ${p.crypto_experience}`);
  if (p?.primary_device) demoLines.push(`- 주 사용 기기: ${p.primary_device}`);
  if (p?.languages?.length) demoLines.push(`- 언어: ${p.languages.join(', ')}`);
  if (v.demographics?.tech_literacy != null)
    demoLines.push(`- 기술 이해도: ${pct(v.demographics.tech_literacy)}`);
  if (v.demographics?.patience_level != null)
    demoLines.push(`- 인내심: ${pct(v.demographics.patience_level)}`);

  const prefsLines: string[] = [];
  if (p?.ui_preference) prefsLines.push(`- UI 선호: ${p.ui_preference}`);
  if (p?.design_matters != null)
    prefsLines.push(`- 디자인 민감도: ${p.design_matters ? '높음' : '보통'}`);
  if (v.ux_preferences?.visual_style)
    prefsLines.push(`- 비주얼 스타일: ${v.ux_preferences.visual_style}`);
  if (v.ux_preferences?.information_density != null)
    prefsLines.push(`- 정보 밀도 선호: ${pct(v.ux_preferences.information_density)}`);
  if (v.ux_preferences?.mobile_first != null)
    prefsLines.push(`- 모바일 우선: ${v.ux_preferences.mobile_first ? 'yes' : 'no'}`);

  const styleBlock = describe('테스트 스타일', v.test_style, [
    'thoroughness',
    'speed',
    'ux_focus',
    'bug_detection',
    'creativity',
  ] as const);

  const expertiseBlock = describe('전문 도메인', v.expertise, [
    'defi',
    'nft',
    'gaming',
    'ai_tools',
    'general_web',
  ] as const);

  const feedbackBlock = describe('피드백 편향', v.feedback_pattern, [
    'ui_critical',
    'security_aware',
    'performance_sensitive',
    'accessibility_focus',
    'detail_oriented',
  ] as const);

  const reliabilityBlock = describe('신뢰성', v.reliability, [
    'quality_score',
    'consistency',
    'response_rate',
  ] as const);

  const frustrations = p?.frustration_triggers?.length
    ? `**불만 유발 요소**: ${p.frustration_triggers.join(', ')}`
    : '';

  const voice = v.voice_sample
    ? `**보이스 샘플** (이 페르소나의 말투·어조)\n> ${v.voice_sample.trim()}`
    : '';

  return [
    section('인물', demoLines),
    section('UX 선호', prefsLines),
    styleBlock,
    expertiseBlock,
    feedbackBlock,
    reliabilityBlock,
    frustrations,
    voice,
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}
