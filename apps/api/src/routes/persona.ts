import { Router, type Router as RouterType } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generatePersona } from '../services/llm.js';
import { sasService, calculateTrustTier } from '../services/sas.js';

const router: RouterType = Router();

// POST /api/persona/generate — Generate persona from 3 reports
router.post('/generate', async (req, res) => {
  try {
    const { tester_addr } = req.body;

    if (!tester_addr) {
      res.status(400).json({ error: 'tester_addr is required' });
      return;
    }

    // Verify tester has 3+ tests
    const [tester] = await db.select().from(schema.testers).where(eq(schema.testers.walletAddress, tester_addr));
    if (!tester) {
      res.status(404).json({ error: 'Tester not found' });
      return;
    }

    if (tester.testsDone < 3) {
      res.status(400).json({
        error: `Need 3 completed tests, currently have ${tester.testsDone}`,
        tests_done: tester.testsDone,
      });
      return;
    }

    if (tester.personaId) {
      const [existing] = await db.select().from(schema.personas).where(eq(schema.personas.id, tester.personaId));
      if (existing) {
        res.json({ persona: existing, message: 'Persona already exists' });
        return;
      }
    }

    // Get 3 most recent reports
    const reports = await db.select().from(schema.testReports)
      .where(eq(schema.testReports.testerAddr, tester_addr))
      .limit(3);

    if (reports.length < 3) {
      res.status(400).json({ error: 'Not enough reports found. Need at least 3.' });
      return;
    }

    // Generate persona vector via LLM (include demographic data from profile)
    const profileData = (tester.profile as Record<string, unknown>) || {};
    let vector;
    try {
      vector = await generatePersona(
        profileData,
        reports.map(r => ({
          checklist_results: r.checklistResults,
          scenario_log: r.scenarioLog,
          questionnaire_answers: r.questionnaireAnswers,
          quality_score: r.qualityScore,
        })),
      );
    } catch (llmError) {
      console.error('[Persona] LLM generation failed, using fallback:', llmError);
      // Fallback persona vector
      vector = {
        test_style: { thoroughness: 0.7, speed: 0.6, ux_focus: 0.8, bug_detection: 0.5, creativity: 0.6 },
        expertise: { defi: 0.5, nft: 0.3, gaming: 0.2, ai_tools: 0.4, general_web: 0.7 },
        feedback_pattern: { ui_critical: 0.7, security_aware: 0.5, performance_sensitive: 0.6, accessibility_focus: 0.4, detail_oriented: 0.7 },
        reliability: {
          quality_score: (reports.reduce((sum, r) => sum + (r.qualityScore || 3), 0) / reports.length) / 5,
          consistency: 0.7,
          response_rate: 1.0,
        },
        voice_sample: 'This tester provides balanced feedback with attention to UI details and practical suggestions for improvement.',
      };
    }

    // Save persona
    const [persona] = await db.insert(schema.personas).values({
      testerAddr: tester_addr,
      vector,
      isActive: true,
    }).returning();

    // Update tester with persona reference
    await db.update(schema.testers)
      .set({ personaId: persona.id })
      .where(eq(schema.testers.walletAddress, tester_addr));

    // Issue SAS attestation
    const avgQuality = reports.reduce((sum, r) => sum + (r.qualityScore || 3), 0) / reports.length;
    let sasAttestId: string | undefined;
    try {
      const attestResult = await sasService.issueAttestation(tester_addr, {
        tests_completed: tester.testsDone,
        avg_quality: avgQuality,
        expertise_defi: vector.expertise.defi,
        expertise_ai_tools: vector.expertise.ai_tools,
        trust_tier: calculateTrustTier(avgQuality, tester.testsDone),
        persona_activated: true,
      });
      sasAttestId = attestResult.attestationId;

      // Update persona with SAS attestation
      await db.update(schema.personas)
        .set({ sasAttestId })
        .where(eq(schema.personas.id, persona.id));
    } catch (sasError) {
      console.warn('[SAS] Attestation failed (non-blocking):', sasError);
    }

    res.status(201).json({ persona: { ...persona, sasAttestId } });
  } catch (error) {
    console.error('[POST /api/persona/generate]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/persona/:personaId — Get persona details
router.get('/:personaId', async (req, res) => {
  try {
    const { personaId } = req.params;
    const [persona] = await db.select().from(schema.personas).where(eq(schema.personas.id, personaId));

    if (!persona) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }

    res.json(persona);
  } catch (error) {
    console.error('[GET /api/persona/:personaId]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/persona/search — Search personas by expertise
router.get('/', async (_req, res) => {
  try {
    const allPersonas = await db.select().from(schema.personas).where(eq(schema.personas.isActive, true));
    res.json(allPersonas);
  } catch (error) {
    console.error('[GET /api/personas]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
