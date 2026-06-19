"use client";

// /me/wallet — the user's Sui rewards wallet (decision 나').
//
// Privy creates an embedded Ed25519 wallet ("solana") that the USER
// controls. Solana and Sui share Ed25519, so the same key derives the
// user's Sui address (lib/sui-wallet.ts) — self-custody via Privy login,
// no native Sui support needed. Persona ownership + reward settlement
// will use this address.

import { useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { deriveSuiAddress } from "@/lib/sui-wallet";
import { Btn, C, Card, FM, FS, Frame } from "../../validator/_components/ui";

export default function WalletPage() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useSolanaWallets();
  const [copied, setCopied] = useState(false);

  const solanaAddr = wallets[0]?.address ?? null;
  let suiAddr: string | null = null;
  try {
    suiAddr = solanaAddr ? deriveSuiAddress(solanaAddr) : null;
  } catch {
    suiAddr = null;
  }

  const copy = () => {
    if (!suiAddr) return;
    void navigator.clipboard.writeText(suiAddr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Frame active="discovery">
      <div className="v-page-pad" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <Link
            href="/me"
            style={{ fontSize: 12, color: C.textFaint, fontFamily: FM, textDecoration: "none" }}
          >
            ← My Page
          </Link>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, fontFamily: FS, marginBottom: 6 }}>
          Sui wallet
        </h1>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 22, lineHeight: 1.5 }}>
          You hold this key via your sign-in. Persona ownership and rewards live here.
        </div>

        {!ready ? (
          <div style={{ fontSize: 13, color: C.textDim, fontFamily: FM }}>Loading…</div>
        ) : !authenticated ? (
          <Card>
            <div style={{ fontSize: 13, color: C.textDim, marginBottom: 12 }}>
              Sign in to view your Sui wallet.
            </div>
            <Btn onClick={login}>Sign in</Btn>
          </Card>
        ) : !suiAddr ? (
          <Card>
            <div style={{ fontSize: 13, color: C.textDim }}>
              Setting up your wallet… refresh in a moment.
            </div>
          </Card>
        ) : (
          <Card>
            <div style={{ fontSize: 11, fontFamily: FM, color: C.textFaint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
              Sui address
            </div>
            <div
              style={{
                fontFamily: FM,
                fontSize: 13,
                wordBreak: "break-all",
                color: C.text,
                marginBottom: 14,
              }}
            >
              {suiAddr}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn onClick={copy}>{copied ? "Copied ✓" : "Copy address"}</Btn>
              <Link href="/me/points" style={{ textDecoration: "none" }}>
                <Btn>View points</Btn>
              </Link>
            </div>
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 14, lineHeight: 1.5 }}>
              Sui testnet. Balance + on-chain activity appear here once the
              settlement layer is live.
            </div>
          </Card>
        )}
      </div>
    </Frame>
  );
}
