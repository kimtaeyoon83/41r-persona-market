/**
 * BSC Testnet autotest route — x402 EIP-3009 gated.
 *
 *  1. Client calls POST /run with no X-Payment → 402 with paymentRequirements
 *  2. Client signs EIP-712 authorization via MetaMask, retries with
 *     X-Payment: base64(<X402EvmPayment>)
 *  3. Server verifies signature + business rules, relays
 *     transferWithAuthorization on-chain, then kicks off the autotest job
 *
 * Status polling reuses the same in-memory job store as the Solana path via
 * the shared services/autotest.ts.
 */
import { Router, type Router as RouterType } from 'express';
import { startAutoTest, getAutoTestStatus } from '../services/autotest.js';
import {
  BSC_CAIP2,
  BSC_TESTNET_CHAIN_ID,
  getMockUsdcAddress,
  getResourceWallet,
  parseX402PaymentHeader,
  settleEvmPayment,
  verifyEvmPayment,
} from '../services/evm.js';

const router: RouterType = Router();

const AUTOTEST_PRICE_USDC = 0.1;
const USDC_SMALLEST_UNITS = BigInt(Math.round(AUTOTEST_PRICE_USDC * 1_000_000));

function buildPaymentRequirements() {
  const usdc = (() => {
    try {
      return getMockUsdcAddress();
    } catch {
      return undefined;
    }
  })();
  const payTo = (() => {
    try {
      return getResourceWallet();
    } catch {
      return undefined;
    }
  })();
  return {
    x402Version: 1,
    error: 'Payment Required',
    accepts: [
      {
        scheme: 'exact',
        network: BSC_CAIP2,
        chainId: BSC_TESTNET_CHAIN_ID,
        price: `$${AUTOTEST_PRICE_USDC.toFixed(2)}`,
        amount: USDC_SMALLEST_UNITS.toString(),
        currency: 'USDC',
        asset: usdc,
        payTo,
        description: 'AI Auto Test on BSC testnet — $0.10 MockUSDC per execution',
        eip712: {
          domain: { name: 'USDC', version: '1', chainId: BSC_TESTNET_CHAIN_ID, verifyingContract: usdc },
          primaryType: 'TransferWithAuthorization',
        },
      },
    ],
  };
}

// POST /api/autotest-bsc/run — x402-gated
router.post('/run', async (req, res) => {
  try {
    const { test_id, persona_id } = req.body ?? {};
    if (!test_id || !persona_id) {
      res.status(400).json({ error: 'test_id and persona_id are required' });
      return;
    }

    const xPayment = req.header('X-Payment');
    if (!xPayment) {
      res.status(402).json(buildPaymentRequirements());
      return;
    }

    const payment = parseX402PaymentHeader(xPayment);
    if (!payment) {
      res.status(400).json({ error: 'Malformed X-Payment header' });
      return;
    }

    let payee: `0x${string}`;
    try {
      payee = getResourceWallet();
    } catch (err) {
      res.status(500).json({
        error: 'Server not configured for BSC autotest',
        details: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const verdict = await verifyEvmPayment(payment, payee, USDC_SMALLEST_UNITS);
    if (!verdict.ok) {
      res.status(402).json({ error: 'Payment verification failed', reason: verdict.reason });
      return;
    }

    let settleTxHash: `0x${string}`;
    try {
      settleTxHash = await settleEvmPayment(payment);
    } catch (err) {
      console.error('[autotest-bsc] settlement failed', err);
      res.status(402).json({
        error: 'Payment settlement failed',
        details: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    console.log(`[autotest-bsc] payment settled: ${settleTxHash}`);

    const job = await startAutoTest(test_id, persona_id);
    res.json({
      job_id: job.id,
      status: job.status,
      payment: {
        network: BSC_CAIP2,
        txHash: settleTxHash,
        explorer: `https://testnet.bscscan.com/tx/${settleTxHash}`,
        amount: USDC_SMALLEST_UNITS.toString(),
        asset: getMockUsdcAddress(),
      },
      message: 'Auto test started. Poll /api/autotest-bsc/status/:jobId for updates.',
    });
  } catch (err) {
    console.error('[POST /api/autotest-bsc/run]', err);
    res.status(500).json({
      error: 'Failed to start auto test',
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// GET /api/autotest-bsc/status/:jobId — shared job store with Solana path
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = getAutoTestStatus(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      report_id: job.reportId,
      error: job.error,
      result: job.status === 'completed' ? job.result : undefined,
    });
  } catch (err) {
    console.error('[GET /api/autotest-bsc/status]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/autotest-bsc/requirements — helper for frontend to fetch price info
router.get('/requirements', (_req, res) => {
  res.json(buildPaymentRequirements());
});

export default router;
