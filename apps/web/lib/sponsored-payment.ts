// Sponsored 0 USDC tx for /api/scan/:id/payment-tx + /payment-confirm.
//
// Extracted from validator/detail/page.tsx so Mode A (Discovery) and
// Mode B (Verify) — and any future scan-creating flow — share one
// payment path. Before this helper, Mode B was creating scans without
// signing the sponsored tx, leaving no Solscan receipt and no userId
// claim on the scan row.
//
// The helper is hook-agnostic: callers pass in `signTransaction` from
// Privy's `useSignTransaction` and the wallet object from `useWallets`.
// We never import Privy here so this file is also usable from any
// client component without pulling Privy through.

import { scanApi } from "./api";

// We don't pull Privy's types here to keep this layer pure. The
// generic `W` flows through from caller to the signTransaction call
// so Privy's full ConnectedStandardSolanaWallet type is preserved
// at the call site without this helper having to know about it —
// only the narrow `{ address: string }` constraint is enforced.
type SignTransactionFn<W extends { address: string }> = (args: {
  transaction: Uint8Array;
  wallet: W;
  chain?: string;
}) => Promise<{ signedTransaction?: Uint8Array } | undefined>;

export type SponsoredPaymentStage = "signing" | "broadcasting" | "done";

export type SponsoredPaymentResult =
  /** Tx signed + submitted; Solscan receipt should appear shortly. */
  | { kind: "ok" }
  /** Pre-conditions not met (anonymous user / no embedded wallet) —
   *  scan still runs anonymously, just without a payment record. */
  | { kind: "skipped"; reason: string }
  /** Sign / submit threw. Caller should surface the message; the
   *  underlying scan keeps running (server-side worker is decoupled). */
  | { kind: "error"; message: string };

export async function performSponsoredPayment<W extends { address: string }>(args: {
  scanId: string;
  authenticated: boolean;
  wallet: W | undefined;
  signTransaction: SignTransactionFn<W>;
  onStage?: (stage: SponsoredPaymentStage) => void;
}): Promise<SponsoredPaymentResult> {
  const { scanId, authenticated, wallet, signTransaction, onStage } = args;
  if (!authenticated) {
    return { kind: "skipped", reason: "not authenticated" };
  }
  if (!wallet) {
    return { kind: "skipped", reason: "no Solana wallet available" };
  }

  try {
    onStage?.("signing");
    const build = await scanApi.getPaymentTx(scanId);
    const txBytes = base64ToBytes(build.txBase64);
    // eslint-disable-next-line no-console
    console.log("[payment] requesting sign", {
      scanId,
      txBytesLen: txBytes.length,
      walletAddress: wallet.address,
    });
    const signResult = await signTransaction({
      transaction: txBytes,
      wallet,
      // Privy default chain is solana:mainnet; we run on devnet, so
      // an explicit override is required to avoid "No RPC config
      // found for chain solana:devnet" from the sponsored tx path.
      chain: "solana:devnet",
    });
    // eslint-disable-next-line no-console
    console.log("[payment] sign result", {
      keys: Object.keys(signResult ?? {}),
      isUint8Array: signResult?.signedTransaction instanceof Uint8Array,
      length: signResult?.signedTransaction?.length,
    });
    const signedBytes = signResult?.signedTransaction;
    if (!(signedBytes instanceof Uint8Array)) {
      throw new Error(
        `Privy returned unexpected sign result shape: ${JSON.stringify(
          Object.keys(signResult ?? {}),
        )}`,
      );
    }
    onStage?.("broadcasting");
    await scanApi.confirmPayment(scanId, bytesToBase64(signedBytes));
    onStage?.("done");
    return { kind: "ok" };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[payment] failed", err);
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// Local base64 utils — same body as the previous private helpers in
// validator/detail/page.tsx. Browser-only (atob/btoa).
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}
