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
