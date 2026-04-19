import { Router, type Router as RouterType } from 'express';
import { issueNonce } from '../middleware/auth.js';
import { walletAddressSchema } from '../schemas/common.js';

const router: RouterType = Router();

// GET /api/auth/nonce?wallet=<base58>
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

export default router;
