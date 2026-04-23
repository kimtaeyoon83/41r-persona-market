/**
 * Dev harness — same pipeline as production but with blockchain
 * preamble (wallet signatures, x402 payment, USDC deposit, SAS
 * attestation network call) stripped off. Every mutating endpoint
 * calls the same service functions the production routes use, so
 * the output is bit-identical to what a real paying company would
 * get. This lets the assistant exercise tester → test → report →
 * persona → diagnosis loops autonomously for regression checks.
 *
 * Auth: x-dev-key header must match DEV_TEST_KEY env var. See
 * middleware/dev_auth.ts. When the env var is missing the whole
 * router is never mounted (index.ts), so these endpoints 404
 * silently in real prod configurations.
 */
import { Router, type Router as RouterType } from 'express';
import { and, eq, inArray, desc } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db, schema } from '../db/index.js';
import { generateTestCases } from '../services/llm.js';
import { recomputePersona } from '../services/persona.js';
import { requireDevKey } from '../middleware/dev_auth.js';

const router: RouterType = Router();
router.use(requireDevKey);

// ── Fake-wallet / id helpers ────────────────────────────────────────

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Id(len = 44): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += BASE58[bytes[i] % BASE58.length];
  }
  return out;
}

// ── Tester ──────────────────────────────────────────────────────────

router.post('/tester', async (req, res) => {
  try {
    const {
      wallet_address,
      display_name,
      profile,
    } = req.body as {
      wallet_address?: string;
      display_name?: string;
      profile?: Record<string, unknown>;
    };

    const wallet = wallet_address ?? base58Id(44);
    const name = display_name ?? `Dev Tester ${wallet.slice(0, 6)}`;

    const [inserted] = await db
      .insert(schema.testers)
      .values({
        walletAddress: wallet,
        displayName: name,
        profile: (profile as unknown as typeof schema.testers.$inferInsert.profile) ?? {
          expertise: ['web'],
          experience_level: 'intermediate',
          preferred_domains: ['saas'],
          ui_preference: 'clean',
          languages: ['en'],
          device_types: ['desktop'],
        },
      })
      .onConflictDoNothing()
      .returning();

    if (!inserted) {
      const [existing] = await db
        .select()
        .from(schema.testers)
        .where(eq(schema.testers.walletAddress, wallet));
      res.status(200).json({ tester: existing, created: false });
      return;
    }
    res.json({ tester: inserted, created: true });
  } catch (err) {
    console.error('[dev POST /tester]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal' });
  }
});

// ── Test (register) ─────────────────────────────────────────────────

router.post('/test', async (req, res) => {
  try {
    const {
      company_wallet,
      target_url,
      requirements,
      enable_auto_test,
      budget_usdc,
      reward_per_tester,
    } = req.body as {
      company_wallet?: string;
      target_url?: string;
      requirements?: string;
      enable_auto_test?: boolean;
      budget_usdc?: number;
      reward_per_tester?: number;
    };
    if (!target_url) {
      res.status(400).json({ error: 'target_url required' });
      return;
    }

    const companyAddr = company_wallet ?? base58Id(44);

    // Ensure company exists (same as prod /register).
    const [existingCompany] = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.walletAddress, companyAddr));
    if (!existingCompany) {
      await db.insert(schema.companies).values({
        walletAddress: companyAddr,
        companyName: `Dev Company ${companyAddr.slice(0, 6)}`,
      });
    }

    const [test] = await db
      .insert(schema.tests)
      .values({
        companyAddr,
        targetUrl: target_url,
        requirements: requirements ?? '',
        budgetUsdc: budget_usdc ?? 50,
        rewardPerTester: reward_per_tester ?? 3,
        status: 'pending',
      })
      .returning();

    // Generate test cases (same path as prod /register).
    let testCasesData;
    try {
      testCasesData = await generateTestCases(target_url, requirements ?? '');
    } catch (err) {
      console.warn('[dev POST /test] LLM test case generation failed; using fallback:', err);
      testCasesData = {
        checklist: [
          { id: 'CL01', task: 'Load the main page and verify no console errors', expected: 'Page loads fully without errors within 3 seconds' },
          { id: 'CL02', task: 'Check all navigation links', expected: 'Links navigate without 404s' },
          { id: 'CL03', task: 'Submit the primary form with valid data', expected: 'Form submits successfully' },
        ],
        scenarios: [],
        questionnaire: [
          { id: 'Q01', question: 'How intuitive was the UI?', type: 'rating_1_5' as const },
          { id: 'Q02', question: 'Biggest pain point?', type: 'free_text' as const },
        ],
      };
    }

    const allCases = [
      ...testCasesData.checklist.map((c, i) => ({ testId: test.id, type: 'checklist' as const, content: c, order: i })),
      ...testCasesData.scenarios.map((s, i) => ({ testId: test.id, type: 'scenario' as const, content: s, order: i })),
      ...testCasesData.questionnaire.map((q, i) => ({ testId: test.id, type: 'questionnaire' as const, content: q, order: i })),
    ];
    if (allCases.length > 0) {
      await db.insert(schema.testCases).values(allCases);
    }
    await db.update(schema.tests).set({ status: 'active' }).where(eq(schema.tests.id, test.id));

    const queued: Array<{ persona_id: string; tester_addr: string; mode: string }> = [];
    if (enable_auto_test) {
      const allPersonas = await db
        .select()
        .from(schema.personas)
        .where(eq(schema.personas.isActive, true));
      if (allPersonas.length > 0) {
        const { matchPersonas } = await import('../services/matching.js');
        const matches = await matchPersonas(
          requirements ?? '',
          target_url,
          allPersonas.map((p) => ({
            id: p.id,
            testerAddr: p.testerAddr,
            vector: p.vector as unknown as Parameters<typeof matchPersonas>[2][0]['vector'],
          })),
          3,
        );
        const { runStagehandHybridAndPersist } = await import('./autotest.js');
        const { runTextModeAndPersist } = await import('../services/scoring/text_run.js');

        let chain: Promise<unknown> = Promise.resolve();
        for (const match of matches) {
          const personaId = match.persona.id;
          const testerAddr = match.persona.testerAddr;
          queued.push({ persona_id: personaId, tester_addr: testerAddr, mode: 'stagehand_hybrid' });
          queued.push({ persona_id: personaId, tester_addr: testerAddr, mode: 'text' });
          chain = chain.then(() =>
            runStagehandHybridAndPersist({ testId: test.id, personaId }).catch((e) => {
              console.warn(`[dev autotest] stagehand_hybrid failed for ${personaId}:`, e instanceof Error ? e.message : e);
            }),
          );
          void runTextModeAndPersist({ testId: test.id, personaId }).catch((e) => {
            console.warn(`[dev autotest] text failed for ${personaId}:`, e instanceof Error ? e.message : e);
          });
        }
        void chain;
      }
    }

    res.json({
      test: { ...test, status: 'active' },
      test_cases: testCasesData,
      queued,
      company_wallet: companyAddr,
    });
  } catch (err) {
    console.error('[dev POST /test]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal' });
  }
});

// ── Manual report submit (no payment) ───────────────────────────────

router.post('/report/manual', async (req, res) => {
  try {
    const {
      tester_addr,
      test_id,
      checklist_results,
      scenario_log,
      questionnaire_answers,
      screenshots,
    } = req.body as {
      tester_addr?: string;
      test_id?: string;
      checklist_results?: Array<{ id: string; status: 'passed' | 'failed' | 'blocked'; memo: string }>;
      scenario_log?: Array<{ id: string; timeline: Array<{ time: string; action: string; screenshot?: string }> }>;
      questionnaire_answers?: Array<{ id: string; answer: string | number }>;
      screenshots?: string[];
    };
    if (!tester_addr || !test_id) {
      res.status(400).json({ error: 'tester_addr and test_id required' });
      return;
    }

    const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, test_id));
    if (!test) {
      res.status(404).json({ error: 'test not found' });
      return;
    }
    const [tester] = await db.select().from(schema.testers).where(eq(schema.testers.walletAddress, tester_addr));
    if (!tester) {
      res.status(404).json({ error: 'tester not found (create via /api/dev/tester first)' });
      return;
    }

    // Compute quality exactly the way prod does — same LLM.
    const { calculateQualityScore } = await import('../services/llm.js');
    const quality = await calculateQualityScore({
      checklist_results: checklist_results ?? [],
      scenario_log: scenario_log ?? [],
      questionnaire_answers: questionnaire_answers ?? [],
      requirements: test.requirements ?? '',
    });

    const [inserted] = await db
      .insert(schema.testReports)
      .values({
        testerAddr: tester_addr,
        testId: test_id,
        checklistResults: checklist_results ?? [],
        scenarioLog: scenario_log ?? [],
        questionnaireAnswers: questionnaire_answers ?? [],
        qualityScore: quality.score,
        isPersonaTest: false,
        sourceMode: 'manual',
        screenshots: screenshots ?? [],
      })
      .onConflictDoNothing({
        target: [
          schema.testReports.testerAddr,
          schema.testReports.testId,
          schema.testReports.isPersonaTest,
          schema.testReports.sourceMode,
        ],
      })
      .returning();

    if (!inserted) {
      res.status(409).json({ error: 'manual report already exists for this (tester, test)' });
      return;
    }

    // Bump testsDone so persona recompute gate eventually flips.
    await db
      .update(schema.testers)
      .set({ testsDone: (tester.testsDone ?? 0) + 1 })
      .where(eq(schema.testers.walletAddress, tester_addr));

    res.json({
      report: inserted,
      quality,
    });
  } catch (err) {
    console.error('[dev POST /report/manual]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal' });
  }
});

// ── Autotest trigger (same auto-queue the register endpoint uses) ───

router.post('/autotest/trigger', async (req, res) => {
  try {
    const { test_id, modes, persona_id } = req.body as {
      test_id?: string;
      modes?: Array<'stagehand_hybrid' | 'text'>;
      persona_id?: string; // optional: run for a single persona
    };
    if (!test_id) {
      res.status(400).json({ error: 'test_id required' });
      return;
    }
    const selectedModes: Array<'stagehand_hybrid' | 'text'> = modes ?? ['stagehand_hybrid', 'text'];

    const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, test_id));
    if (!test) {
      res.status(404).json({ error: 'test not found' });
      return;
    }

    const allPersonas = await db.select().from(schema.personas).where(eq(schema.personas.isActive, true));
    if (allPersonas.length === 0) {
      res.status(409).json({ error: 'no active personas' });
      return;
    }

    let matches: Array<{ persona: { id: string; testerAddr: string } }>;
    if (persona_id) {
      const p = allPersonas.find((x) => x.id === persona_id);
      if (!p) {
        res.status(404).json({ error: `persona ${persona_id} not found` });
        return;
      }
      matches = [{ persona: { id: p.id, testerAddr: p.testerAddr } }];
    } else {
      const { matchPersonas } = await import('../services/matching.js');
      matches = await matchPersonas(
        test.requirements ?? '',
        test.targetUrl,
        allPersonas.map((p) => ({
          id: p.id,
          testerAddr: p.testerAddr,
          vector: p.vector as unknown as Parameters<typeof matchPersonas>[2][0]['vector'],
        })),
        3,
      );
    }

    const existingReports = await db
      .select()
      .from(schema.testReports)
      .where(and(eq(schema.testReports.testId, test_id), eq(schema.testReports.isPersonaTest, true)));
    const covered = new Set(existingReports.map((r) => `${r.testerAddr}::${r.sourceMode}`));

    const { runStagehandHybridAndPersist } = await import('./autotest.js');
    const { runTextModeAndPersist } = await import('../services/scoring/text_run.js');

    let chain: Promise<unknown> = Promise.resolve();
    const queued: Array<{ persona_id: string; tester_addr: string; mode: string }> = [];
    let skipped = 0;

    for (const m of matches) {
      const personaId = m.persona.id;
      const testerAddr = m.persona.testerAddr;
      for (const mode of selectedModes) {
        if (covered.has(`${testerAddr}::${mode}`)) {
          skipped += 1;
          continue;
        }
        queued.push({ persona_id: personaId, tester_addr: testerAddr, mode });
        if (mode === 'stagehand_hybrid') {
          chain = chain.then(() =>
            runStagehandHybridAndPersist({ testId: test_id, personaId }).catch((e) => {
              console.warn(`[dev autotest] stagehand_hybrid failed for ${personaId}:`, e instanceof Error ? e.message : e);
            }),
          );
        } else {
          void runTextModeAndPersist({ testId: test_id, personaId }).catch((e) => {
            console.warn(`[dev autotest] text failed for ${personaId}:`, e instanceof Error ? e.message : e);
          });
        }
      }
    }
    void chain;

    res.json({ test_id, queued_count: queued.length, skipped_existing: skipped, queued });
  } catch (err) {
    console.error('[dev POST /autotest/trigger]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal' });
  }
});

// ── Persona recompute ───────────────────────────────────────────────

router.post('/persona/recompute', async (req, res) => {
  try {
    const { tester_addr, trigger } = req.body as { tester_addr?: string; trigger?: 'manual' | 'report_submit' | 'admin' };
    if (!tester_addr) {
      res.status(400).json({ error: 'tester_addr required' });
      return;
    }
    const result = await recomputePersona(tester_addr, trigger ?? 'manual');
    if (!result) {
      res.status(409).json({ error: 'not enough reports to compute persona (need 3+)' });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error('[dev POST /persona/recompute]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal' });
  }
});

// ── Diagnosis generate ──────────────────────────────────────────────

router.post('/diagnosis/generate', async (req, res) => {
  try {
    const { test_id } = req.body as { test_id?: string };
    if (!test_id) {
      res.status(400).json({ error: 'test_id required' });
      return;
    }
    const reports = await db
      .select({ id: schema.testReports.id })
      .from(schema.testReports)
      .where(eq(schema.testReports.testId, test_id));
    if (reports.length < 3) {
      res.status(409).json({ error: `need at least 3 reports, have ${reports.length}` });
      return;
    }
    const { generateAndStoreDiagnosis } = await import('../services/scoring/diagnosis.js');
    const out = await generateAndStoreDiagnosis(test_id);
    res.json({
      test_id,
      markdown: out.markdown,
      generated_at: out.generatedAt.toISOString(),
      generated_for_report_count: out.reportCount,
    });
  } catch (err) {
    console.error('[dev POST /diagnosis/generate]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal' });
  }
});

// ── Snapshot: full state of a test for verification ─────────────────

router.get('/snapshot/:test_id', async (req, res) => {
  try {
    const testId = String(req.params.test_id);
    const [test] = await db.select().from(schema.tests).where(eq(schema.tests.id, testId));
    if (!test) {
      res.status(404).json({ error: 'test not found' });
      return;
    }

    const cases = await db.select().from(schema.testCases).where(eq(schema.testCases.testId, testId));
    const checklistCases = cases.filter((c) => c.type === 'checklist').map((c) => c.content);
    const questionnaireCases = cases
      .filter((c) => c.type === 'questionnaire')
      .map((c) => c.content as { id: string; question: string; type: string });
    const questionnaireTypeById = new Map<string, string>();
    for (const q of questionnaireCases) questionnaireTypeById.set(q.id, q.type);

    const reports = await db
      .select()
      .from(schema.testReports)
      .where(eq(schema.testReports.testId, testId))
      .orderBy(desc(schema.testReports.createdAt));

    // Per-report verification flags.
    const reportSummaries = reports.map((r) => {
      const cl = (r.checklistResults as Array<{ id: string; status: string; memo: string }> | null) ?? [];
      const fallbackCount = cl.filter(
        (c) => (c.memo ?? '').startsWith('키워드 매칭') || (c.memo ?? '').includes('태스크 증거 없음'),
      ).length;
      const checklistIdsInReport = new Set(cl.map((c) => c.id));
      const checklistIdsInCases = new Set(checklistCases.map((c) => (c as { id: string }).id));
      const unknownChecklistIds = [...checklistIdsInReport].filter((id) => !checklistIdsInCases.has(id));
      const missingChecklistIds = [...checklistIdsInCases].filter((id) => !checklistIdsInReport.has(id));

      const answers = (r.questionnaireAnswers as Array<{ id: string; answer: string | number }> | null) ?? [];
      const userAnswers = answers.filter((a) => !a.id.startsWith('_'));
      const sentinels = answers.filter((a) => a.id.startsWith('_')).map((a) => a.id);
      const invalidRatings: Array<{ id: string; answer: unknown; type: string }> = [];
      for (const a of userAnswers) {
        const t = questionnaireTypeById.get(a.id);
        if (t === 'rating_1_5' && typeof a.answer === 'number' && (a.answer < 1 || a.answer > 5)) {
          invalidRatings.push({ id: a.id, answer: a.answer, type: t });
        }
        if (t === 'rating_1_10' && typeof a.answer === 'number' && (a.answer < 1 || a.answer > 10)) {
          invalidRatings.push({ id: a.id, answer: a.answer, type: t });
        }
      }

      let structuredReport: unknown = null;
      const sr = answers.find((a) => a.id === '_structured_report');
      if (sr && typeof sr.answer === 'string') {
        try { structuredReport = JSON.parse(sr.answer); } catch { /* leave null */ }
      }
      let qualityBreakdown: unknown = null;
      const qb = answers.find((a) => a.id === '_quality_breakdown');
      if (qb && typeof qb.answer === 'string') {
        try { qualityBreakdown = JSON.parse(qb.answer); } catch { /* leave null */ }
      }

      return {
        id: r.id,
        testerAddr: r.testerAddr,
        sourceMode: r.sourceMode,
        isPersonaTest: r.isPersonaTest,
        qualityScore: r.qualityScore,
        createdAt: r.createdAt?.toISOString(),
        checklist: {
          total: cl.length,
          passed: cl.filter((c) => c.status === 'passed').length,
          failed: cl.filter((c) => c.status === 'failed').length,
          blocked: cl.filter((c) => c.status === 'blocked').length,
          fallback_memos: fallbackCount,
        },
        questionnaire: {
          user_answers: userAnswers.length,
          sentinels,
          invalid_ratings: invalidRatings,
        },
        screenshots_count: Array.isArray(r.screenshots) ? (r.screenshots as string[]).length : 0,
        structured_report: structuredReport,
        quality_breakdown: qualityBreakdown,
        integrity: {
          unknown_checklist_ids: unknownChecklistIds,
          missing_checklist_ids: missingChecklistIds,
        },
      };
    });

    // Involved personas — testers that have persona rows for this test's reporter set.
    const testerAddrs = [...new Set(reports.map((r) => r.testerAddr))];
    const personas = testerAddrs.length > 0
      ? await db.select().from(schema.personas).where(inArray(schema.personas.testerAddr, testerAddrs))
      : [];
    const testers = testerAddrs.length > 0
      ? await db.select().from(schema.testers).where(inArray(schema.testers.walletAddress, testerAddrs))
      : [];

    // Aggregate stats
    const qs = reports.map((r) => r.qualityScore).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    const totalFallbackMemos = reportSummaries.reduce((s, r) => s + r.checklist.fallback_memos, 0);

    res.json({
      test: {
        id: test.id,
        targetUrl: test.targetUrl,
        requirements: test.requirements,
        status: test.status,
        createdAt: test.createdAt?.toISOString(),
        diagnosisGeneratedAt: test.diagnosisGeneratedAt?.toISOString() ?? null,
        diagnosisReportCount: test.diagnosisReportCount,
        hasDiagnosis: !!test.diagnosisMd,
      },
      test_cases_summary: {
        checklist: checklistCases.length,
        scenarios: cases.filter((c) => c.type === 'scenario').length,
        questionnaire: questionnaireCases.length,
      },
      reports: reportSummaries,
      reports_by_mode: {
        stagehand_hybrid: reports.filter((r) => r.sourceMode === 'stagehand_hybrid').length,
        text: reports.filter((r) => r.sourceMode === 'text').length,
        manual: reports.filter((r) => r.sourceMode === 'manual').length,
      },
      quality_stats: qs.length > 0 ? {
        min: Math.min(...qs),
        max: Math.max(...qs),
        avg: Number((qs.reduce((a, b) => a + b, 0) / qs.length).toFixed(2)),
        count: qs.length,
      } : null,
      integrity_summary: {
        total_fallback_memos: totalFallbackMemos,
        reports_with_fallback: reportSummaries.filter((r) => r.checklist.fallback_memos > 0).length,
      },
      personas: personas.map((p) => ({
        id: p.id,
        testerAddr: p.testerAddr,
        isActive: p.isActive,
        sasAttestId: p.sasAttestId,
        voice_sample: (p.vector as { voice_sample?: string })?.voice_sample?.slice(0, 200),
      })),
      testers: testers.map((t) => ({
        walletAddress: t.walletAddress,
        displayName: t.displayName,
        testsDone: t.testsDone,
        profile: t.profile,
      })),
      diagnosis_markdown: test.diagnosisMd,
    });
  } catch (err) {
    console.error('[dev GET /snapshot]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal' });
  }
});

// ── Full orchestration ──────────────────────────────────────────────

router.post('/flow/full', async (req, res) => {
  try {
    const {
      target_url,
      requirements,
      persona_count,
      manual_reporter_count,
    } = req.body as {
      target_url?: string;
      requirements?: string;
      persona_count?: number;
      manual_reporter_count?: number;
    };
    if (!target_url) {
      res.status(400).json({ error: 'target_url required' });
      return;
    }

    // 1. Create company wallet + test (auto-queue enabled).
    const companyAddr = base58Id(44);
    await db.insert(schema.companies).values({
      walletAddress: companyAddr,
      companyName: `Dev Flow ${companyAddr.slice(0, 6)}`,
    });
    const [test] = await db
      .insert(schema.tests)
      .values({
        companyAddr,
        targetUrl: target_url,
        requirements: requirements ?? '',
        budgetUsdc: 50,
        rewardPerTester: 3,
        status: 'pending',
      })
      .returning();

    // 2. Generate test cases.
    let testCasesData;
    try {
      testCasesData = await generateTestCases(target_url, requirements ?? '');
    } catch (err) {
      console.warn('[dev /flow/full] test case gen failed:', err);
      testCasesData = { checklist: [], scenarios: [], questionnaire: [] };
    }
    const allCases = [
      ...testCasesData.checklist.map((c, i) => ({ testId: test.id, type: 'checklist' as const, content: c, order: i })),
      ...testCasesData.scenarios.map((s, i) => ({ testId: test.id, type: 'scenario' as const, content: s, order: i })),
      ...testCasesData.questionnaire.map((q, i) => ({ testId: test.id, type: 'questionnaire' as const, content: q, order: i })),
    ];
    if (allCases.length > 0) {
      await db.insert(schema.testCases).values(allCases);
    }
    await db.update(schema.tests).set({ status: 'active' }).where(eq(schema.tests.id, test.id));

    // 3. Trigger dual-mode auto-queue.
    const queued: Array<{ persona_id: string; tester_addr: string; mode: string }> = [];
    const allPersonas = await db.select().from(schema.personas).where(eq(schema.personas.isActive, true));
    if (allPersonas.length > 0) {
      const { matchPersonas } = await import('../services/matching.js');
      const matches = await matchPersonas(
        requirements ?? '',
        target_url,
        allPersonas.map((p) => ({
          id: p.id,
          testerAddr: p.testerAddr,
          vector: p.vector as unknown as Parameters<typeof matchPersonas>[2][0]['vector'],
        })),
        persona_count ?? 3,
      );
      const { runStagehandHybridAndPersist } = await import('./autotest.js');
      const { runTextModeAndPersist } = await import('../services/scoring/text_run.js');
      let chain: Promise<unknown> = Promise.resolve();
      for (const m of matches) {
        queued.push({ persona_id: m.persona.id, tester_addr: m.persona.testerAddr, mode: 'stagehand_hybrid' });
        queued.push({ persona_id: m.persona.id, tester_addr: m.persona.testerAddr, mode: 'text' });
        const personaId = m.persona.id;
        const testId = test.id;
        chain = chain.then(() => runStagehandHybridAndPersist({ testId, personaId }).catch((e) => console.warn('[dev flow] sh fail:', e instanceof Error ? e.message : e)));
        void runTextModeAndPersist({ testId, personaId }).catch((e) => console.warn('[dev flow] tx fail:', e instanceof Error ? e.message : e));
      }
      void chain;
    }

    // 4. Create manual testers + fake manual reports.
    const manualTesterAddrs: string[] = [];
    const manualCount = manual_reporter_count ?? 1;
    for (let i = 0; i < manualCount; i++) {
      const wallet = base58Id(44);
      await db
        .insert(schema.testers)
        .values({
          walletAddress: wallet,
          displayName: `Dev Human ${i + 1}`,
          profile: {
            expertise: ['web'],
            experience_level: 'intermediate',
            preferred_domains: ['saas'],
            ui_preference: 'clean',
            languages: ['en'],
            device_types: ['desktop'],
          },
        })
        .onConflictDoNothing();
      manualTesterAddrs.push(wallet);
    }

    res.json({
      test_id: test.id,
      company_wallet: companyAddr,
      test_status: 'active',
      checklist_count: testCasesData.checklist.length,
      queued_persona_runs: queued.length,
      manual_tester_addrs: manualTesterAddrs,
      next_steps: [
        `GET /api/dev/snapshot/${test.id} — poll until queued_persona_runs land`,
        `POST /api/dev/report/manual for each manual_tester_addr to complete the human side`,
        `POST /api/dev/diagnosis/generate once ≥ 3 reports`,
      ],
    });
  } catch (err) {
    console.error('[dev POST /flow/full]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal' });
  }
});

export default router;
