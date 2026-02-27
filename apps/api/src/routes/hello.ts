/**
 * GET /api/hello — x402 payment-gated endpoint
 *
 * This route sits behind the x402 middleware. When a request arrives without
 * a valid payment header the middleware returns 402 + payment instructions.
 * Once payment is verified the request reaches this handler.
 */
import { Router, type Router as RouterType } from 'express';

const router: RouterType = Router();

router.get('/', (_req, res) => {
  res.json({
    message: 'Hello from 41R Persona Market!',
    paid: true,
    timestamp: new Date().toISOString(),
    note: 'You paid ~$0.001 USDC on Solana devnet to access this endpoint.',
  });
});

export default router;
