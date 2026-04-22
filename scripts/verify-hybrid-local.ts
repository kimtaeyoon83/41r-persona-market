/**
 * Integration check for runStagehandHybridAndPersist: runs the full
 * Chromium + in-process scoring chain end-to-end against a throwaway
 * test row. Prints the resulting test_reports row so we can eyeball
 * whether the "키워드 매칭" fallback is actually gone on real data.
 *
 * Run (from repo root):
 *   export ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' .env | cut -d= -f2-)
 *   export DATABASE_URL="postgresql://postgres:...@gondola.proxy.rlwy.net:42069/railway"
 *   pnpm --filter api exec tsx /abs/path/to/scripts/verify-hybrid-local.ts
 *
 * Cleanup is best-effort — if the process is killed mid-run you may
 * leave a stray tests row with target_url=https://example.com. The
 * test_reports unique index still protects against duplicate runs.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

for (const need of ['ANTHROPIC_API_KEY', 'DATABASE_URL']) {
  if (!process.env[need]) {
    console.error(`${need} missing — see header comment for invocation`);
    process.exit(1);
  }
}

import { eq } from 'drizzle-orm';

// Pick a persona that doesn't already have an isPersonaTest=true report
// on our throwaway test (the test is new so no persona has; any works).
const PERSONA_ID = process.env.PERSONA_ID ?? '8ad99b05-b2b0-459e-82ff-e08b012ec814';
const TARGET_URL = process.env.TARGET_URL ?? 'https://www.inven.co.kr/';
const TASK =
  process.env.TASK ?? '내가 원하는 게임 정보를 쉽게 찾고 접근할 수 있는지 확인';

async function main() {
  // Dynamic import so env vars land first (anthropic_client reads at load).
  const dbMod = await import(path.resolve(here, '..', 'apps/api/src/db/index.js'));
  const { db, schema } = dbMod as typeof import('../apps/api/src/db/index.js');
  const autotestMod = await import(path.resolve(here, '..', 'apps/api/src/routes/autotest.js'));
  const { runStagehandHybridAndPersist } = autotestMod as typeof import('../apps/api/src/routes/autotest.js');

  // 1. Verify persona exists.
  const [persona] = await db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.id, PERSONA_ID));
  if (!persona) {
    console.error(`persona ${PERSONA_ID} not found`);
    process.exit(1);
  }
  console.log(`✓ persona ${PERSONA_ID} (tester ${persona.testerAddr.slice(0, 10)}...)`);

  // 2. Create throwaway company (FK target), test, test_cases.
  const companyAddr = 'LOCAL_VERIFY_' + Date.now();
  await db.insert(schema.companies).values({
    walletAddress: companyAddr,
    companyName: 'Local Verify Harness',
  });
  const [test] = await db
    .insert(schema.tests)
    .values({
      companyAddr,
      targetUrl: TARGET_URL,
      requirements: TASK,
      budgetUsdc: 1,
      rewardPerTester: 0.1,
      status: 'active',
    })
    .returning();
  console.log(`✓ created temp test ${test.id} → ${TARGET_URL}`);

  const checklist = [
    { id: 'CL01', task: '메인 페이지의 주요 카테고리를 한눈에 파악', expected: '상단 네비게이션 또는 배너' },
    { id: 'CL02', task: '검색 기능이 제공되며 동작', expected: '검색창 존재 및 반응' },
    { id: 'CL03', task: '콘텐츠 카테고리가 명확히 분리', expected: '탭/섹션/메뉴 구분' },
    { id: 'CL04', task: '게시물 날짜가 표시되어 최신성 판단 가능', expected: '제목 옆/아래 날짜' },
  ];
  const questionnaire = [
    { id: 'Q01', question: '정보 접근성에 대한 전반적 만족도', type: 'rating_1_5' as const },
    { id: 'Q02', question: '네비게이션의 명확성', type: 'rating_1_5' as const },
    { id: 'Q03', question: '가장 인상적이었던 점', type: 'free_text' as const },
    { id: 'Q04', question: '가장 개선이 필요한 점', type: 'free_text' as const },
  ];
  await db.insert(schema.testCases).values([
    ...checklist.map((c, i) => ({
      testId: test.id,
      type: 'checklist' as const,
      content: c,
      order: i,
    })),
    ...questionnaire.map((q, i) => ({
      testId: test.id,
      type: 'questionnaire' as const,
      content: q,
      order: i,
    })),
  ]);
  console.log(`✓ inserted ${checklist.length} checklist + ${questionnaire.length} questionnaire items`);

  // 3. Run the hybrid path end-to-end.
  console.log('== runStagehandHybridAndPersist (real Chromium, ~1-2 min) ==');
  const t0 = Date.now();
  try {
    const result = await runStagehandHybridAndPersist({
      testId: test.id,
      personaId: PERSONA_ID,
    });
    const elapsedSec = Math.round((Date.now() - t0) / 10) / 100;
    console.log(`✓ completed in ${elapsedSec}s — report ${result.reportId}`);
    console.log(`  outcome=${result.outcome}  quality=${result.qualityScore}  shots=${result.screenshotUrls.length}`);

    // 4. Pull the row back and print evidence.
    const [row] = await db
      .select()
      .from(schema.testReports)
      .where(eq(schema.testReports.id, result.reportId));
    if (!row) {
      console.error('report row missing after insert?');
      process.exit(1);
    }
    console.log();
    console.log('== checklist_results ==');
    for (const r of (row.checklistResults as Array<{ id: string; status: string; memo: string }>) ?? []) {
      console.log(`  ${r.id} [${r.status}] ${r.memo}`);
    }
    const fallbackCount = ((row.checklistResults as Array<{ memo: string }>) ?? []).filter(
      (r) => r.memo.startsWith('키워드 매칭') || r.memo.includes('태스크 증거 없음'),
    ).length;
    console.log(`  fallback memos: ${fallbackCount} (target: 0)`);

    console.log();
    console.log('== questionnaire_answers ==');
    for (const a of (row.questionnaireAnswers as Array<{ id: string; answer: string | number }>) ?? []) {
      if (a.id.startsWith('_')) continue; // skip sentinels
      const val = typeof a.answer === 'string' ? a.answer.slice(0, 120) : a.answer;
      console.log(`  ${a.id}: ${val}`);
    }

    console.log();
    console.log('== structured_report (sentinel) ==');
    const reportSentinel = (row.questionnaireAnswers as Array<{ id: string; answer: string | number }>)?.find(
      (a) => a.id === '_structured_report',
    );
    if (reportSentinel) {
      const rep = JSON.parse(String(reportSentinel.answer));
      console.log(`  summary: ${rep.summary}`);
      console.log(`  ux_scores: ${JSON.stringify(rep.ux_scores)}`);
      console.log(`  pain_points: ${rep.pain_points.length}`);
      for (const p of rep.pain_points) {
        console.log(`    [${p.severity}] ${p.description} (turn=${p.evidence_turn})`);
      }
    }

    console.log();
    console.log('== screenshots ==');
    for (const s of (row.screenshots as string[]) ?? []) console.log(`  ${s}`);
  } catch (e) {
    console.error('hybrid run failed:', e);
  } finally {
    // 5. Cleanup. Preserve the test_report row so you can inspect it
    // in the web UI at /report/<id> — delete the tests+test_cases so
    // the /company dashboard stays clean.
    try {
      await db.delete(schema.testCases).where(eq(schema.testCases.testId, test.id));
    } catch { /* ignore */ }
    // tests row intentionally kept so the /report page can resolve
    // test_id → test.targetUrl for display. If you want full cleanup,
    // also delete test_reports + tests manually.
    console.log();
    console.log(`Cleanup: deleted test_cases for ${test.id}. tests + test_report kept for inspection.`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
