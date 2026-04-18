import { Router, type Router as RouterType } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const router: RouterType = Router();

// GET /api/testers — List all testers with report counts and persona info
router.get('/', async (_req, res) => {
  try {
    const allTesters = await db.select().from(schema.testers);
    const allReports = await db.select({
      testerAddr: schema.testReports.testerAddr,
      id: schema.testReports.id,
      qualityScore: schema.testReports.qualityScore,
      isPersonaTest: schema.testReports.isPersonaTest,
    }).from(schema.testReports);
    const allPersonas = await db.select({
      id: schema.personas.id,
      testerAddr: schema.personas.testerAddr,
      isActive: schema.personas.isActive,
      sasAttestId: schema.personas.sasAttestId,
    }).from(schema.personas);
    const allSettlements = await db.select({
      payeeAddr: schema.settlements.payeeAddr,
      amountToken: schema.settlements.amountToken,
      settlementType: schema.settlements.settlementType,
    }).from(schema.settlements);

    // Build lookup maps for O(N) instead of O(T*R) filtering
    const reportsByTester = new Map<string, typeof allReports>();
    for (const r of allReports) {
      const arr = reportsByTester.get(r.testerAddr) || [];
      arr.push(r);
      reportsByTester.set(r.testerAddr, arr);
    }
    const personaByTester = new Map(allPersonas.map(p => [p.testerAddr, p]));
    const settlementsByPayee = new Map<string, typeof allSettlements>();
    for (const s of allSettlements) {
      const arr = settlementsByPayee.get(s.payeeAddr) || [];
      arr.push(s);
      settlementsByPayee.set(s.payeeAddr, arr);
    }

    const testersWithStats = allTesters.map(t => {
      const reports = reportsByTester.get(t.walletAddress) || [];
      const validReports = reports.filter(r => (r.qualityScore ?? 0) >= 1.5);
      const persona = personaByTester.get(t.walletAddress);
      const settlements = settlementsByPayee.get(t.walletAddress) || [];
      const usdcEarned = settlements.filter(s => s.settlementType === 'usdc').reduce((sum, s) => sum + s.amountToken, 0);
      const tokenEarned = settlements.filter(s => s.settlementType === '41r').reduce((sum, s) => sum + s.amountToken, 0);
      const avgQuality = validReports.length > 0
        ? validReports.reduce((sum, r) => sum + (r.qualityScore ?? 0), 0) / validReports.length
        : 0;

      return {
        ...t,
        stats: {
          totalReports: reports.length,
          validReports: validReports.length,
          rejectedReports: reports.length - validReports.length,
          avgQuality: Math.round(avgQuality * 10) / 10,
          usdcEarned: Math.round(usdcEarned * 100) / 100,
          tokenEarned: Math.round(tokenEarned * 100) / 100,
        },
        persona: persona ? { id: persona.id, isActive: persona.isActive, hasAttestation: !!persona.sasAttestId } : null,
      };
    });

    res.json(testersWithStats);
  } catch (error) {
    console.error('[GET /api/testers]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tester/register — Register a new tester
router.post('/register', async (req, res) => {
  try {
    const { wallet_address, display_name, profile } = req.body;

    if (!wallet_address || !display_name) {
      res.status(400).json({ error: 'wallet_address and display_name are required' });
      return;
    }

    // Validate profile if provided
    if (profile) {
      // Required fields
      if (!Array.isArray(profile.expertise) || profile.expertise.length === 0) {
        res.status(400).json({ error: 'profile.expertise must be a non-empty array' });
        return;
      }
      if (!profile.experience_level) {
        res.status(400).json({ error: 'profile.experience_level is required' });
        return;
      }

      // Validate enum fields if provided
      const validAgeRanges = ['10s', '20s', '30s', '40s', '50s', '60+'];
      if (profile.age_range && !validAgeRanges.includes(profile.age_range)) {
        res.status(400).json({ error: `profile.age_range must be one of: ${validAgeRanges.join(', ')}` });
        return;
      }

      const validCryptoExp = ['none', 'beginner', 'intermediate', 'advanced'];
      if (profile.crypto_experience && !validCryptoExp.includes(profile.crypto_experience)) {
        res.status(400).json({ error: `profile.crypto_experience must be one of: ${validCryptoExp.join(', ')}` });
        return;
      }

      const validDevices = ['mobile', 'desktop'];
      if (profile.primary_device && !validDevices.includes(profile.primary_device)) {
        res.status(400).json({ error: `profile.primary_device must be one of: ${validDevices.join(', ')}` });
        return;
      }
    }

    // Atomic upsert-or-fail: single INSERT with PK conflict skip.
    // Needed because two concurrent /register requests for the same
    // wallet could both pass a prior SELECT check and both INSERT —
    // the second would PK-fail without a clear error path.
    const inserted = await db
      .insert(schema.testers)
      .values({
        walletAddress: wallet_address,
        displayName: display_name,
        profile: profile || null,
      })
      .onConflictDoNothing({ target: schema.testers.walletAddress })
      .returning();

    if (inserted.length === 0) {
      // Row already existed — return 409 with current record so the
      // client can treat it like an idempotent re-register.
      const [existing] = await db
        .select()
        .from(schema.testers)
        .where(eq(schema.testers.walletAddress, wallet_address));
      res.status(409).json({ error: 'Tester already registered', tester: existing });
      return;
    }

    res.status(201).json(inserted[0]);
  } catch (error) {
    console.error('[POST /api/tester/register]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tester/:wallet — Get tester profile
router.get('/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const [tester] = await db.select().from(schema.testers).where(eq(schema.testers.walletAddress, wallet));

    if (!tester) {
      res.status(404).json({ error: 'Tester not found' });
      return;
    }

    // Include persona if exists
    let persona = null;
    if (tester.personaId) {
      const [p] = await db.select().from(schema.personas).where(eq(schema.personas.id, tester.personaId));
      persona = p || null;
    }

    res.json({ tester, persona });
  } catch (error) {
    console.error('[GET /api/tester/:wallet]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/tester/:wallet — Update tester profile
router.put('/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const { display_name, profile } = req.body;

    const updates: Record<string, unknown> = {};
    if (display_name) updates.displayName = display_name;
    if (profile) updates.profile = profile;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const [tester] = await db.update(schema.testers)
      .set(updates)
      .where(eq(schema.testers.walletAddress, wallet))
      .returning();

    if (!tester) {
      res.status(404).json({ error: 'Tester not found' });
      return;
    }

    res.json(tester);
  } catch (error) {
    console.error('[PUT /api/tester/:wallet]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
