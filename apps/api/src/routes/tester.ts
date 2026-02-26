import { Router, type Router as RouterType } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const router: RouterType = Router();

// POST /api/tester/register — Register a new tester
router.post('/register', async (req, res) => {
  try {
    const { wallet_address, display_name, profile } = req.body;

    if (!wallet_address || !display_name) {
      res.status(400).json({ error: 'wallet_address and display_name are required' });
      return;
    }

    // Check if already exists
    const existing = await db.select().from(schema.testers).where(eq(schema.testers.walletAddress, wallet_address));
    if (existing.length > 0) {
      res.status(409).json({ error: 'Tester already registered', tester: existing[0] });
      return;
    }

    const [tester] = await db.insert(schema.testers).values({
      walletAddress: wallet_address,
      displayName: display_name,
      profile: profile || null,
    }).returning();

    res.status(201).json(tester);
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
