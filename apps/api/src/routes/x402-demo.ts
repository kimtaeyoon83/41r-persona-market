/**
 * x402 Micropayment Demo Routes
 *
 * GET /api/x402-demo/test-402  — Show what a 402 Payment Required response looks like
 * GET /api/x402-demo/test-paid — Make a paid request using @x402/fetch client-side helpers
 */
import { Router, type Router as RouterType } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const router: RouterType = Router();

/** Solana devnet in CAIP-2 format */
const SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

// ---------------------------------------------------------------------------
// GET /api/x402-demo/test-402
// ---------------------------------------------------------------------------
// Calls the payment-gated /api/hello WITHOUT any payment header so the x402
// middleware responds with 402.  Returns the parsed payment requirements.
// ---------------------------------------------------------------------------
router.get('/test-402', async (_req, res) => {
  const port = process.env.API_PORT || 4100;
  const targetUrl = `http://localhost:${port}/api/hello`;

  try {
    const response = await fetch(targetUrl);

    if (response.status !== 402) {
      res.json({
        info: 'Expected a 402 response but got something else — is x402 middleware active?',
        status: response.status,
        body: await response.json().catch(() => response.text()),
      });
      return;
    }

    // The x402 middleware returns payment requirements either:
    //   - in the response body (JSON) for the fallback middleware, or
    //   - in the "Payment-Required" header (base64-encoded JSON) for the x402 standard middleware
    let paymentRequirements: unknown = null;

    // Try the standard x402 header first
    const paymentHeader = response.headers.get('payment-required');
    if (paymentHeader) {
      try {
        paymentRequirements = JSON.parse(
          Buffer.from(paymentHeader, 'base64').toString('utf-8'),
        );
      } catch {
        // Header might not be base64 — try plain JSON
        try {
          paymentRequirements = JSON.parse(paymentHeader);
        } catch {
          paymentRequirements = paymentHeader;
        }
      }
    }

    // Also grab the JSON body (fallback middleware puts info here)
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }

    res.json({
      info: 'This is what a 402 Payment Required response looks like.',
      status: response.status,
      statusText: response.statusText,
      paymentRequiredHeader: paymentRequirements,
      body,
      explanation: {
        howItWorks:
          'The server requires payment before serving the resource. ' +
          'A client that understands x402 will read the payment requirements, ' +
          'construct and sign a Solana transaction, then retry the request ' +
          'with an X-Payment header containing the signed transaction.',
        paymentRequirements: paymentRequirements
          ? 'See paymentRequiredHeader above for the decoded requirements.'
          : 'Payment requirements are in the response body (fallback mode).',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/x402-demo/test-402]', message);
    res.status(500).json({
      error: 'Failed to call the gated endpoint',
      details: message,
      hint: 'Is the API server running and x402 middleware active?',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/x402-demo/test-paid
// ---------------------------------------------------------------------------
// Loads the Solana keypair, sets up the x402 client with ExactSvmScheme,
// wraps fetch with payment capabilities, and calls /api/hello WITH payment.
// ---------------------------------------------------------------------------
router.get('/test-paid', async (_req, res) => {
  const port = process.env.API_PORT || 4100;
  const targetUrl = `http://localhost:${port}/api/hello`;

  try {
    // ---- Load Solana keypair ----
    const rawKeypairPath =
      process.env.SOLANA_KEYPAIR_PATH ||
      path.join(os.homedir(), '.config', 'solana', 'id.json');
    const keypairPath = rawKeypairPath.startsWith('~')
      ? path.join(os.homedir(), rawKeypairPath.slice(1))
      : rawKeypairPath;

    if (!fs.existsSync(keypairPath)) {
      res.status(500).json({
        error: 'Solana keypair file not found',
        path: keypairPath,
        hint:
          'Set SOLANA_KEYPAIR_PATH env var or run `solana-keygen new` to create a default keypair.',
      });
      return;
    }

    const keypairBytes = new Uint8Array(
      JSON.parse(fs.readFileSync(keypairPath, 'utf-8')),
    );

    // ---- Build x402 client ----
    const signer = await createKeyPairSignerFromBytes(keypairBytes);
    const client = new x402Client().register(
      SOLANA_DEVNET,
      new ExactSvmScheme(signer),
    );
    const paidFetch = wrapFetchWithPayment(fetch, client);

    // ---- Make the paid request ----
    const startMs = Date.now();
    const response = await paidFetch(targetUrl);
    const elapsedMs = Date.now() - startMs;

    const responseBody = await response.json().catch(() => response.text());

    if (!response.ok) {
      res.status(response.status).json({
        info: 'The paid request did not succeed.',
        status: response.status,
        statusText: response.statusText,
        body: responseBody,
        elapsedMs,
        signerAddress: signer.address,
        hint:
          'This usually means the wallet has no devnet USDC. ' +
          'Get some from the Circle faucet: https://faucet.circle.com/',
      });
      return;
    }

    res.json({
      info: 'Payment successful! The x402 client automatically handled the 402 negotiation.',
      status: response.status,
      body: responseBody,
      payment: {
        note: 'x402/fetch intercepted the initial 402, signed a Solana transaction, and retried the request with an X-Payment header.',
        network: SOLANA_DEVNET,
        signerAddress: signer.address,
      },
      elapsedMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[GET /api/x402-demo/test-paid]', message);
    res.status(500).json({
      error: 'Paid request failed',
      details: message,
      stack: process.env.NODE_ENV !== 'production' ? stack : undefined,
      hints: [
        'Ensure SOLANA_KEYPAIR_PATH points to a valid Solana keypair JSON file.',
        'The keypair wallet needs devnet USDC. Get some from https://faucet.circle.com/',
        'Make sure the API server is running with x402 middleware enabled.',
      ],
    });
  }
});

export default router;
