import { Router, type Router as RouterType } from 'express';
import { issueNonce } from '../middleware/auth.js';
import { walletAddressSchema } from '../schemas/common.js';
import { requirePrivyAuth } from '../middleware/privy_auth.js';

const router: RouterType = Router();

// GET /api/auth/nonce?wallet=<base58>
// Legacy from the autotest era. Unused by the validator surface — kept
// so existing API clients don't 404 during the Phase 4 migration. Will
// be removed in Phase 3 cleanup once nothing references it.
router.get('/nonce', (req, res) => {
  const raw = req.query.wallet;
  const parsed = walletAddressSchema.safeParse(typeof raw === 'string' ? raw : undefined);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid base58 wallet query parameter is required' });
    return;
  }
  const { nonce, expiresAt } = issueNonce(parsed.data);
  res.json({ nonce, expiresAt });
});

// GET /api/auth/me — Phase 4 §1 single-auth lookup.
// Verifies the Privy bearer token, upserts the user into 41R DB, and
// returns the canonical user payload the web app uses for the
// `authenticated` UI state.
router.get('/me', requirePrivyAuth, (req, res) => {
  // requirePrivyAuth guarantees req.privyUser is set when next() fires.
  const u = req.privyUser!;
  res.json({
    user: {
      id: u.id,
      privyId: u.privyId,
      email: u.email,
      walletAddress: u.walletAddress,
      displayName: u.displayName,
    },
  });
});

export default router;
