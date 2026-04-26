/**
 * x402 Micropayment Middleware for Express
 *
 * Sets up the x402 payment protocol middleware for Solana USDC payments.
 * Uses the Coinbase x402 facilitator (https://x402.org/facilitator) for
 * payment verification and settlement on Solana devnet.
 *
 * FALLBACK: If the x402 facilitator is unavailable on devnet, a custom
 * USDC payment verification middleware is included below.
 */
import type { Request, Response, NextFunction } from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Solana devnet in CAIP-2 format */
export const SOLANA_DEVNET: `${string}:${string}` = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

/** Coinbase public x402 facilitator (supports Solana devnet) */
const FACILITATOR_URL = 'https://x402.org/facilitator';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getPayToAddress(): string {
  return env.X402_RESOURCE_WALLET;
}

// ---------------------------------------------------------------------------
// x402 Middleware Factory
// ---------------------------------------------------------------------------

/**
 * Creates the x402 payment middleware configured for Solana devnet USDC.
 *
 * Usage:
 *   app.use(createX402Middleware());
 *
 * Protected routes are defined in the `routes` map below.
 */
export function createX402Middleware() {
  const payTo = getPayToAddress();

  const facilitatorClient = new HTTPFacilitatorClient({
    url: FACILITATOR_URL,
  });

  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    SOLANA_DEVNET,
    new ExactSvmScheme(),
  );

  const routes = {
    'GET /api/hello': {
      accepts: [
        {
          scheme: 'exact' as const,
          price: '$0.001',
          network: SOLANA_DEVNET,
          payTo,
        },
      ],
      description: 'Pay-gated hello endpoint (x402 PoC)',
      mimeType: 'application/json',
    },
    'GET /api/test/:testId/results': {
      accepts: [
        {
          scheme: 'exact' as const,
          price: '$0.05',
          network: SOLANA_DEVNET,
          payTo,
        },
      ],
      description: 'Access test results and reports — $0.05 per request',
      mimeType: 'application/json',
    },
    'GET /api/persona/search': {
      accepts: [
        {
          scheme: 'exact' as const,
          price: '$0.05',
          network: SOLANA_DEVNET,
          payTo,
        },
      ],
      description: 'Search AI Personas by expertise — $0.05 per query',
      mimeType: 'application/json',
    },
    'GET /api/persona/:personaId': {
      accepts: [
        {
          scheme: 'exact' as const,
          price: '$0.10',
          network: SOLANA_DEVNET,
          payTo,
        },
      ],
      description: 'Access AI Persona details and vector — $0.10 per view',
      mimeType: 'application/json',
    },
  };

  return paymentMiddleware(routes, resourceServer);
}

// ===========================================================================
// FALLBACK: Custom USDC Payment Verification Middleware
// ===========================================================================
//
// If the x402 facilitator does not work reliably on Solana devnet, swap
// `createX402Middleware()` for `createFallbackPaymentMiddleware()` in your
// Express app.  This middleware:
//   1. Returns 402 with payment instructions when no X-Payment header is set.
//   2. Verifies an SPL Token transfer transaction on devnet when the header
//      is present.
// ===========================================================================

import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

/** Devnet USDC mint (Circle faucet) */
const USDC_MINT_DEVNET = new PublicKey(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
);

/** Price in USDC smallest units (6 decimals). 1000 = 0.001 USDC */
const PRICE_LAMPORTS = 1000;

interface FallbackPaymentInfo {
  recipientWallet: string;
  tokenAccount: string;
  mint: string;
  amount: number;
  amountUSDC: number;
}

/**
 * Fallback middleware that manually verifies USDC SPL-token transfers on
 * Solana devnet via the X-Payment header. Use this if the x402 facilitator
 * does not support devnet or is unreachable.
 */
export function createFallbackPaymentMiddleware() {
  const payTo = getPayToAddress();
  const recipientPubkey = new PublicKey(payTo);
  const connection = new Connection(env.SOLANA_RPC_URL, 'confirmed');

  // Pre-compute ATA (async, cached after first call)
  let ataPromise: Promise<PublicKey> | null = null;
  function getATA(): Promise<PublicKey> {
    if (!ataPromise) {
      ataPromise = getAssociatedTokenAddress(USDC_MINT_DEVNET, recipientPubkey);
    }
    return ataPromise;
  }

  /** Paths that require payment (method + path pattern) */
  const protectedRoutes = new Set([
    'GET /api/hello',
    'GET /api/persona/search',
  ]);

  /** Path patterns with dynamic segments */
  const protectedPatterns = [
    { method: 'GET', pattern: /^\/api\/test\/[^/]+\/results$/ },
    { method: 'GET', pattern: /^\/api\/persona\/[0-9a-f-]{36}$/ },
  ];

  return async (req: Request, res: Response, next: NextFunction) => {
    const routeKey = `${req.method} ${req.path}`;
    const isProtected = protectedRoutes.has(routeKey) ||
      protectedPatterns.some(p => p.method === req.method && p.pattern.test(req.path));
    if (!isProtected) {
      return next();
    }

    const xPayment = req.header('X-Payment');

    // ----- No payment header: return 402 with instructions -----
    if (!xPayment) {
      const ata = await getATA();
      const paymentInfo: FallbackPaymentInfo = {
        recipientWallet: payTo,
        tokenAccount: ata.toBase58(),
        mint: USDC_MINT_DEVNET.toBase58(),
        amount: PRICE_LAMPORTS,
        amountUSDC: PRICE_LAMPORTS / 1_000_000,
      };
      res.status(402).json({
        error: 'Payment Required',
        x402Version: 1,
        payment: paymentInfo,
      });
      return;
    }

    // ----- Verify payment -----
    try {
      const paymentData = JSON.parse(
        Buffer.from(xPayment, 'base64').toString('utf-8'),
      );

      const txBuffer = Buffer.from(
        paymentData.payload.serializedTransaction,
        'base64',
      );
      const tx = Transaction.from(txBuffer);

      const ata = await getATA();
      let validTransfer = false;

      for (const ix of tx.instructions) {
        if (!ix.programId.equals(TOKEN_PROGRAM_ID)) continue;
        // SPL Token Transfer instruction: discriminator byte 3
        if (ix.data.length >= 9 && ix.data[0] === 3) {
          const amount = Number(ix.data.readBigUInt64LE(1));
          const dest = ix.keys[1]?.pubkey;
          if (dest?.equals(ata) && amount >= PRICE_LAMPORTS) {
            validTransfer = true;
            break;
          }
        }
      }

      if (!validTransfer) {
        res.status(402).json({ error: 'Invalid transfer destination or amount' });
        return;
      }

      // Simulate before submitting
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        res.status(402).json({
          error: 'Transaction simulation failed',
          details: sim.value.err,
        });
        return;
      }

      // Submit and confirm
      const signature = await connection.sendRawTransaction(txBuffer, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      await connection.confirmTransaction(signature, 'confirmed');

      // Attach payment proof to request for downstream handlers
      (req as Request & { paymentSignature?: string }).paymentSignature = signature;
      next();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[fallback-x402] Payment verification failed:', message);
      res.status(402).json({
        error: 'Payment verification failed',
        details: message,
      });
    }
  };
}
