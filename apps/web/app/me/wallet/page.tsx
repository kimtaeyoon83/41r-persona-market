"use client";

// /me/wallet — rewards wallet panel.
//
// After the Sui chain transition (design v0.4 §0.1) persona ownership +
// rewards moved to a SERVER-CUSTODIED Sui wallet (decision: option 가).
// Users no longer hold a client-side Solana embedded wallet, so this
// page is an informational panel. The custodied Sui address + balance
// surface here once the /api/me Sui-wallet endpoint lands (migration E5).

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { Btn, C, Card, FM, FS, Frame } from "../../validator/_components/ui";

export default function WalletPage() {
  const { ready, authenticated, login } = usePrivy();

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
          Rewards wallet
        </h1>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 22, lineHeight: 1.5 }}>
          Your persona ownership and reward settlement live on Sui.
        </div>

        {!ready ? (
          <div style={{ fontSize: 13, color: C.textDim, fontFamily: FM }}>Loading…</div>
        ) : !authenticated ? (
          <Card>
            <div style={{ fontSize: 13, color: C.textDim, marginBottom: 12 }}>
              Sign in to view your rewards wallet.
            </div>
            <Btn onClick={login}>Sign in</Btn>
          </Card>
        ) : (
          <Card>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              Managed Sui wallet
            </div>
            <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6 }}>
              Your Sui wallet is custodied for you — no seed phrase to manage.
              Persona objects you own and USDC-equivalent rewards settle to it
              automatically. The on-chain address and balance will appear here
              once the Sui settlement layer is live.
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/me/points" style={{ textDecoration: "none" }}>
                <Btn>View points</Btn>
              </Link>
              <Link href="/console" style={{ textDecoration: "none" }}>
                <Btn>Console</Btn>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </Frame>
  );
}
