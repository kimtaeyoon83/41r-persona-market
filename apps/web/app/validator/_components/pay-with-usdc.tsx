"use client";

// "Pay with USDC" — the on-chain escrow payment flow (chain wiring §4.3).
//
// createScan(payment_method:'usdc') → escrow envelope → build create-escrow PTB
// → Privy-sign as the user → POST /:id/pay (server verifies on-chain) → onPaid.
//
// ✅ The Privy raw-sign → Sui signature path (lib/sui-wallet.ts) was
// live-verified in-browser 2026-06-22 (/dev/verify-sign — signMessage
// raw-signs the digest, Sui accepts it). Testnet USDC; credits stays the
// default rail, this is the opt-in on-chain escrow path.

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignMessage } from "@privy-io/react-auth/solana";
import { scanApi } from "@/lib/api";
import { buildCreateUsdcCampaignTx } from "@/lib/sui-pay";
import { deriveSuiAddress, signAndExecuteSuiTx } from "@/lib/sui-wallet";

type ScanBody = Parameters<typeof scanApi.createScan>[0];

export function PayWithUsdcButton({
  scanBody,
  onPaid,
  disabled,
}: {
  scanBody: ScanBody;
  onPaid: (scanId: string) => void;
  disabled?: boolean;
}) {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  async function pay() {
    setErr(null);
    if (!authenticated) {
      login();
      return;
    }
    const wallet = wallets[0];
    if (!wallet) {
      setErr("Wallet not ready — refresh after sign-in.");
      return;
    }
    setBusy(true);
    try {
      setStep("Creating scan…");
      const created = await scanApi.createScan({ ...scanBody, payment_method: "usdc" });
      if (!created.escrow) throw new Error("Server returned no escrow envelope.");

      setStep("Building USDC escrow…");
      const suiAddr = deriveSuiAddress(wallet.address);
      const tx = await buildCreateUsdcCampaignTx(suiAddr, created.escrow);

      setStep("Sign in your wallet…");
      const signed = await signAndExecuteSuiTx(tx, {
        solanaAddressBase58: wallet.address,
        signMessage: async (m) => (await signMessage({ message: m, wallet })).signature,
      });
      if (!signed.campaignObjectId || !signed.capId) {
        throw new Error("Escrow create returned no campaign/cap id.");
      }

      setStep("Verifying payment…");
      await scanApi.payScan(created.scanId, {
        sui_digest: signed.digest,
        campaign_object_id: signed.campaignObjectId,
        cap_id: signed.capId,
      });
      onPaid(created.scanId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Payment failed.");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  const amount = Number(scanBody.mode === "B" ? 1 : 2);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        onClick={pay}
        disabled={busy || disabled}
        className="hf-btn primary"
        style={{ opacity: busy || disabled ? 0.6 : 1 }}
      >
        {busy ? step || "Processing…" : `Pay ${amount} USDC (Sui escrow)`}
      </button>
      {err && (
        <div style={{ fontSize: 11, color: "var(--danger, #c0392b)", lineHeight: 1.4 }}>
          {err}
          {err.includes("USDC") && (
            <>
              {" "}
              <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
                Get testnet USDC ↗
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
