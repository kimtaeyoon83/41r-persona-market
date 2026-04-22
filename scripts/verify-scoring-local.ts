/**
 * Local verification for the TS scoring port. Builds a realistic rich
 * session_log (with page_text + a11y + url populated — i.e. what the
 * new bookend enrichment in stagehand_hybrid produces) and runs it
 * through scoreChecklist + answerQuestionnaire + generateStructuredReport.
 *
 * Success criteria:
 *   - checklist memos are NOT "키워드 매칭 (...)" or "관찰된 행동에서
 *     태스크 증거 없음" for items the session clearly evidenced
 *   - structured_report.summary references actual page content, not
 *     generic prose
 *   - questionnaire answers are in the 2..4 rating band with non-empty
 *     free_text that cites specific observations
 *
 * Run (from repo root):
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter api exec tsx ../../scripts/verify-scoring-local.ts
 *
 * Or with the repo .env:
 *   export $(grep -v '^#' .env | xargs) && pnpm --filter api exec tsx scripts/verify-scoring-local.ts
 */

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY missing — pass it via env before running this script');
  process.exit(1);
}

import { scoreChecklist } from '../apps/api/src/services/scoring/checklist.js';
import { answerQuestionnaire } from '../apps/api/src/services/scoring/questionnaire.js';
import { generateStructuredReport } from '../apps/api/src/services/scoring/report.js';
import { computeQualityScore } from '../apps/api/src/services/scoring/quality.js';
import { buildPersonaSoul } from '../apps/api/src/services/scoring/persona_soul.js';
import type { SessionLog } from '../apps/api/src/services/scoring/types.js';

// Synthetic session_log that simulates what the new stagehand_hybrid
// captures: bookend turns with rich page state + middle turns with
// agent reasoning. URL is inven.co.kr (same target as the prod test
// that produced all-failed reports) so we can A/B the output.
const sessionLog: SessionLog = {
  session_id: 'sh_localtest01',
  persona_id: 'p_test',
  url: 'https://www.inven.co.kr/',
  task: '내가 원하는 게임 정보들을 쉽게 찾고 접근이 가능한지 검토해줘',
  mode: 'browser',
  outcome: 'task_complete',
  total_turns: 4,
  start_time: new Date(Date.now() - 90_000).toISOString(),
  end_time: new Date().toISOString(),
  duration_sec: 90,
  turns: [
    {
      turn: 0,
      observation: {
        summary:
          '초기 페이지 상태 — 인벤: 게임 포털. 상단 네비 = [웹진 공략 커뮤니티 게임캘린더 쇼핑 인벤몰]. 주요 배너 = "디아블로4 시즌 7 공략", "로스트아크 vs 원신". 검색창 상단 우측.',
        page_text:
          '인벤 | 게임 포털. 상단 메뉴: 웹진 공략 커뮤니티 게임캘린더 쇼핑 인벤몰. 추천 카테고리: 리그오브레전드 오버워치 디아블로4 로스트아크 원신. 검색창. 로그인 회원가입.',
        url: 'https://www.inven.co.kr/',
        title: '인벤 - 게임 포털 사이트',
        a11y: JSON.stringify({
          role: 'WebArea',
          name: '인벤 - 게임 포털 사이트',
          children: [
            { role: 'navigation', name: '주 메뉴' },
            { role: 'searchbox', name: '사이트 검색' },
            { role: 'link', name: '디아블로4 시즌 7 공략' },
          ],
        }),
      },
      decision: { action: 'goto', reasoning: 'initial navigation', done: false },
      tool: { tool: 'goto', target: 'https://www.inven.co.kr/' },
    },
    {
      turn: 1,
      observation: {
        summary:
          '[에이전트 판단] 게임별 정보 접근성을 확인하려면 검색창에 특정 게임명을 입력하고 결과 카테고리 분포를 본다 / instruction=검색창에 "디아블로4" 입력 후 엔터',
      },
      decision: {
        action: 'act',
        reasoning: '게임별 정보 접근성을 확인하려면 검색',
        instruction: '검색창에 "디아블로4" 입력 후 엔터',
        done: false,
      },
      tool: { tool: 'act', target: '검색창에 "디아블로4" 입력 후 엔터' },
    },
    {
      turn: 2,
      observation: {
        summary:
          '[에이전트 판단] 검색 결과 페이지가 웹진/공략/커뮤니티 카테고리로 자동 분류되어 보임. 디아블로4 인벤 전용 서브도메인 링크 "diablo4.inven.co.kr" 상단에 노출됨.',
      },
      decision: {
        action: 'observe',
        reasoning: '검색 결과 페이지 구조 확인',
        done: false,
      },
      tool: { tool: 'observe', target: 'search results' },
    },
    {
      turn: 3,
      observation: {
        summary:
          '최종 페이지 상태 — 디아블로4 인벤: 공략 허브. 탭 = [공략 뉴스 커뮤니티 DB 경매장]. 최근 공략 = "시즌 7 빌드 가이드 TOP 10", "신규 던전 공략". 업데이트 날짜 명시됨.',
        page_text:
          '디아블로4 인벤. 공략 허브. 시즌 7 빌드 가이드 TOP 10. 신규 던전 공략. 커뮤니티 게시판: 질문 / 팁 / 자랑. 업데이트: 2026-04-20.',
        url: 'https://diablo4.inven.co.kr/',
        title: '디아블로4 인벤 - 공략 허브',
        a11y: JSON.stringify({
          role: 'WebArea',
          name: '디아블로4 인벤 - 공략 허브',
          children: [
            { role: 'tablist', name: '카테고리' },
            { role: 'tab', name: '공략' },
            { role: 'tab', name: '커뮤니티' },
          ],
        }),
      },
      decision: { action: 'observe', reasoning: 'post-agent final state', done: true },
      tool: { tool: 'observe', target: 'https://diablo4.inven.co.kr/' },
    },
  ],
  screenshot_paths: ['/tmp/fake/turn_00.png', '/tmp/fake/turn_01.png'],
};

const checklist = [
  {
    id: 'CL01',
    task: '메인 페이지 로드 시 주요 게임 카테고리를 3초 이내에 식별 가능',
    expected: '상단 네비게이션 또는 메인 배너에 주요 게임 이름이 노출',
  },
  {
    id: 'CL02',
    task: '검색창을 이용해 특정 게임("디아블로4")의 전용 허브 페이지로 이동 가능',
    expected: '검색 결과 상단에 전용 서브도메인 링크 노출',
  },
  {
    id: 'CL03',
    task: '전용 허브 내에서 공략 / 뉴스 / 커뮤니티 카테고리로 분리되어 있음',
    expected: '탭 또는 섹션으로 명확히 구분',
  },
  {
    id: 'CL04',
    task: '콘텐츠에 업데이트 날짜가 표시되어 최신성 확인 가능',
    expected: '게시물 제목 옆 또는 하단에 날짜',
  },
  {
    id: 'CL05',
    task: '회원가입 모달을 열 수 있음',
    expected: '상단 링크 클릭 시 가입 양식 표시',
  },
];

const questionnaire = [
  { id: 'Q01', question: '정보 접근성에 대한 전반적 만족도', type: 'rating_1_5' as const },
  { id: 'Q02', question: '상단 네비게이션의 명확성', type: 'rating_1_5' as const },
  { id: 'Q03', question: '가장 인상적이었던 점을 한 문장으로', type: 'free_text' as const },
  { id: 'Q04', question: '가장 개선이 필요한 점을 한 문장으로', type: 'free_text' as const },
];

const soulText = buildPersonaSoul({
  persona: {
    id: 'p_test',
    vector: {
      test_style: {
        thoroughness: 0.8,
        speed: 0.4,
        ux_focus: 0.9,
        bug_detection: 0.6,
        creativity: 0.5,
      },
      expertise: { defi: 0.1, nft: 0.1, gaming: 0.9, ai_tools: 0.3, general_web: 0.7 },
      feedback_pattern: {
        ui_critical: 0.85,
        security_aware: 0.3,
        performance_sensitive: 0.6,
        accessibility_focus: 0.5,
        detail_oriented: 0.8,
      },
      reliability: { quality_score: 4.0, consistency: 0.8, response_rate: 0.85 },
      voice_sample: '게이머 입장에서 정보 찾기가 번거로우면 바로 다른 사이트 가버립니다.',
    } as any,
  },
  tester: {
    displayName: 'Tester',
    profile: {
      age_range: '30s',
      occupation: '게임 개발자',
      region: 'KR',
      crypto_experience: 'beginner',
      primary_device: 'desktop',
      expertise: ['gaming'],
      experience_level: 'senior',
      preferred_domains: ['gaming'],
      ui_preference: 'information-dense',
      languages: ['ko'],
      device_types: ['desktop'],
      design_matters: true,
      frustration_triggers: ['정보 찾기 어려움', '느린 로딩'],
    },
  },
});

async function main() {
  console.log('== persona soul preview ==');
  console.log(soulText);
  console.log();
  console.log('== scoreChecklist ==');
  const checklistResults = await scoreChecklist({ checklist, sessionLog });
  for (const r of checklistResults) {
    console.log(`  ${r.id} [${r.status}] ${r.memo}`);
  }
  console.log();
  console.log('== answerQuestionnaire ==');
  const answers = await answerQuestionnaire({ questionnaire, sessionLog, soulText });
  for (const a of answers) {
    console.log(`  ${a.id}: ${typeof a.answer === 'string' ? a.answer : a.answer}`);
  }
  console.log();
  console.log('== generateStructuredReport ==');
  const report = await generateStructuredReport({
    sessionLog,
    personaId: 'p_test',
    checklistResults,
  });
  console.log('  summary:', report.summary);
  console.log('  ux_scores:', JSON.stringify(report.ux_scores));
  console.log('  pain_points:');
  for (const p of report.pain_points) {
    console.log(`    [${p.severity}] ${p.description} (turn=${p.evidence_turn})`);
  }
  console.log('  positive_signals:', report.positive_signals);
  console.log('  recommendations:', report.recommendations);
  console.log();
  console.log('== computeQualityScore ==');
  const quality = computeQualityScore({ sessionLog, checklistResults });
  console.log(JSON.stringify(quality, null, 2));
  console.log();
  console.log('== summary ==');
  const fallbackMemos = checklistResults.filter(
    (r) => r.memo.startsWith('키워드 매칭') || r.memo.includes('태스크 증거 없음'),
  );
  console.log(`  checklist passed: ${checklistResults.filter((r) => r.status === 'passed').length}/${checklistResults.length}`);
  console.log(`  fallback memos (bad sign): ${fallbackMemos.length}`);
  console.log(`  quality_score: ${quality.quality_score}`);
  if (fallbackMemos.length > 0) {
    console.log('  ⚠ some items still hit rule-based fallback. Sample:');
    for (const r of fallbackMemos.slice(0, 3)) console.log(`    ${r.id}: ${r.memo}`);
  } else {
    console.log('  ✓ all items scored by LLM with evidence');
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
