import { Router, type Router as RouterType } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { sasService, calculateTrustTier } from '../services/sas.js';
import { recomputePersona } from '../services/persona.js';

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

    // Delegate to the shared recompute pipeline. This creates the
    // persona, appends persona_versions v1, and issues a SAS
    // attestation. Returns null if the tester has < 3 reports — the
    // testsDone check above should prevent that, but we defend anyway.
    const result = await recomputePersona(tester_addr, 'manual');
    if (!result) {
      res.status(400).json({ error: 'Not enough reports found. Need at least 3.' });
      return;
    }

    const [persona] = await db.select().from(schema.personas)
      .where(eq(schema.personas.id, result.personaId));

    res.status(201).json({
      persona,
      sas_on_chain: result.sasOnChain,
      version_num: result.versionNum,
    });
  } catch (error) {
    console.error('[POST /api/persona/generate]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/persona/:personaId/renew-sas — Re-issue on-chain SAS attestation
router.post('/:personaId/renew-sas', async (req, res) => {
  try {
    const { personaId } = req.params;
    const [persona] = await db.select().from(schema.personas).where(eq(schema.personas.id, personaId));

    if (!persona) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }

    // Get tester info for attestation data
    const [tester] = await db.select().from(schema.testers).where(eq(schema.testers.walletAddress, persona.testerAddr));
    if (!tester) {
      res.status(404).json({ error: 'Tester not found' });
      return;
    }

    // Get the 10 most recent reports for quality calculation. An
    // unordered LIMIT would pull an arbitrary slice and mis-rank testers
    // whose quality has drifted over time.
    const reports = await db.select().from(schema.testReports)
      .where(eq(schema.testReports.testerAddr, persona.testerAddr))
      .orderBy(desc(schema.testReports.createdAt))
      .limit(10);

    const avgQuality = reports.length > 0
      ? reports.reduce((sum, r) => sum + (r.qualityScore || 3), 0) / reports.length
      : 3.0;

    const vector = persona.vector as { expertise: Record<string, number> };

    const attestResult = await sasService.issueAttestation(persona.testerAddr, {
      tests_completed: tester.testsDone,
      avg_quality: avgQuality,
      expertise_defi: vector.expertise?.defi || 0,
      expertise_ai_tools: vector.expertise?.ai_tools || 0,
      trust_tier: calculateTrustTier(avgQuality, tester.testsDone),
      persona_activated: true,
    });

    // Update persona with new attestation ID
    await db.update(schema.personas)
      .set({ sasAttestId: attestResult.attestationId, updatedAt: new Date() })
      .where(eq(schema.personas.id, persona.id));

    res.json({
      attestationId: attestResult.attestationId,
      onChain: attestResult.onChain,
      explorerUrl: attestResult.explorerUrl,
    });
  } catch (error) {
    console.error('[POST /api/persona/:personaId/renew-sas]', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
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
