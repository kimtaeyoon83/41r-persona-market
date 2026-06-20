// Chain showcase route — the judge-facing data-provenance surface.
// GET /api/chain/showcase auto-picks the most-anchored scan and returns the
// whole on-chain ↔ Walrus ↔ report linkage for a single page to visualize.
// Read-only, public (no secrets — everything here is already on a public chain).

import { Router, type Router as RouterType } from 'express';
import { buildChainShowcase } from '../services/sui/proof.js';
import { childLogger } from '../logger.js';

const log = childLogger({ svc: 'chain.route' });
const router: RouterType = Router();

router.get('/showcase', async (_req, res) => {
  try {
    const showcase = await buildChainShowcase();
    if (!showcase) {
      res.status(404).json({ error: 'no_anchored_scan' });
      return;
    }
    res.json(showcase);
  } catch (e) {
    log.error({ err: (e as Error).message }, 'chain showcase failed');
    res.status(500).json({ error: 'showcase_failed', detail: (e as Error).message });
  }
});

export default router;
