import { Router, type Router as RouterType } from 'express';
import { Connection } from '@solana/web3.js';
import { startAutoTest, getAutoTestStatus } from '../services/autotest.js';

const router: RouterType = Router();

const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PLATFORM_WALLET = process.env.X402_RESOURCE_WALLET || '8Vm3ys3kwLSy2qThejn56E2j6fptwSE2qcLkEeiLrdB8';
const AUTOTEST_PRICE_USDC = 0.10;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// Verify a USDC transfer on-chain
async function verifyUsdcPayment(txSignature: string): Promise<{ verified: boolean; error?: string }> {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const tx = await connection.getTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { verified: false, error: 'Transaction not found on-chain' };
    }

    if (tx.meta?.err) {
      return { verified: false, error: 'Transaction failed on-chain' };
    }

    // Check token balance changes for USDC transfer to platform wallet
    const postTokenBalances = tx.meta?.postTokenBalances || [];
    const preTokenBalances = tx.meta?.preTokenBalances || [];

    const platformReceived = postTokenBalances.some((post) => {
      if (post.mint !== USDC_MINT) return false;
      if (post.owner !== PLATFORM_WALLET) return false;

      const pre = preTokenBalances.find(
        (p) => p.accountIndex === post.accountIndex,
      );
      const preAmount = pre ? Number(pre.uiTokenAmount.amount) : 0;
      const postAmount = Number(post.uiTokenAmount.amount);
      const diff = postAmount - preAmount;
      // $0.10 USDC = 100000 smallest units (6 decimals)
      return diff >= AUTOTEST_PRICE_USDC * 1_000_000;
    });

    if (!platformReceived) {
      return { verified: false, error: 'No qualifying USDC transfer to platform wallet found' };
    }

    return { verified: true };
  } catch (err) {
    console.warn('[autotest] Payment verification error:', err instanceof Error ? err.message : err);
    return { verified: false, error: 'Verification failed' };
  }
}

// POST /api/autotest/run — Start an auto test job (x402-gated: $0.10 USDC)
router.post('/run', async (req, res) => {
  try {
    const { test_id, persona_id, payment_tx } = req.body;

    if (!test_id || !persona_id) {
      res.status(400).json({ error: 'test_id and persona_id are required' });
      return;
    }

    // x402-style payment gate
    if (!payment_tx) {
      res.status(402).json({
        error: 'Payment Required',
        x402Version: 1,
        description: 'AI Auto Test requires USDC micropayment',
        accepts: [{
          scheme: 'exact',
          network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
          price: `$${AUTOTEST_PRICE_USDC}`,
          currency: 'USDC',
          payTo: PLATFORM_WALLET,
          usdcMint: USDC_MINT,
        }],
      });
      return;
    }

    // Verify payment on-chain
    const { verified, error: verifyError } = await verifyUsdcPayment(payment_tx);
    if (!verified) {
      res.status(402).json({
        error: 'Payment verification failed',
        details: verifyError,
      });
      return;
    }

    console.log(`[autotest] Payment verified: ${payment_tx}`);

    const job = await startAutoTest(test_id, persona_id);
    res.json({
      job_id: job.id,
      status: job.status,
      payment_tx,
      message: 'Auto test started. Poll /api/autotest/status/:jobId for updates.',
    });
  } catch (error) {
    console.error('[POST /api/autotest/run]', error);
    res.status(500).json({ error: 'Failed to start auto test' });
  }
});

// GET /api/autotest/status/:jobId — Get job status
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
  } catch (error) {
    console.error('[GET /api/autotest/status]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
