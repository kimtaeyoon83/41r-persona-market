"use client";

// /me/wallet — the user's Sui rewards wallet (decision 나').
//
// Privy creates an embedded Ed25519 wallet ("solana") that the USER
// controls. Solana and Sui share Ed25519, so the same key derives the
// user's Sui address (lib/sui-wallet.ts) — self-custody via Privy login,
// no native Sui support needed. Persona ownership + reward settlement
// will use this address.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { deriveSuiAddress } from "@/lib/sui-wallet";
import {
  getSuiBalance,
  getUsdcBalance,
  SUI_NETWORK,
  USDC_COIN_TYPE,
  USDC_PAY_ENABLED,
} from "@/lib/sui-pay";
import { Btn, C, Card, FM, FS, Frame } from "../../validator/_components/ui";

// Network label — chain + mainnet/testnet, shown as a pill on the wallet.
const NET_LABEL =
  SUI_NETWORK === "mainnet" ? "Mainnet" : SUI_NETWORK === "testnet" ? "Testnet" : SUI_NETWORK;
const IS_MAINNET = SUI_NETWORK === "mainnet";

export default function WalletPage() {
  const { ready, authenticated, login } = useAuth();
  const { wallets } = useSolanaWallets();
  const [copied, setCopied] = useState(false);
  const [usdc, setUsdc] = useState<string | null>(null);
  const [sui, setSui] = useState<string | null>(null);

  const solanaAddr = wallets[0]?.address ?? null;
  let suiAddr: string | null = null;
  try {
    suiAddr = solanaAddr ? deriveSuiAddress(solanaAddr) : null;
  } catch {
    suiAddr = null;
  }

  useEffect(() => {
    if (!suiAddr) return;
    let live = true;
    // Native SUI (gas) — always fetched so the user can see they can pay fees.
    getSuiBalance(suiAddr)
      .then((b) => live && setSui((Number(b) / 1e9).toFixed(4)))
      .catch(() => live && setSui(null));
    // USDC — only when the on-chain pay rail is enabled.
    if (USDC_PAY_ENABLED) {
      getUsdcBalance(suiAddr, USDC_COIN_TYPE)
        .then((b) => live && setUsdc((Number(b) / 1e6).toFixed(2)))
        .catch(() => live && setUsdc(null));
    }
    return () => {
      live = false;
    };
  }, [suiAddr]);

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
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, fontFamily: FS, margin: 0 }}>
            Sui wallet
          </h1>
          <span
            title={`Sui ${NET_LABEL} · RPC network`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontFamily: FM,
              fontWeight: 600,
              letterSpacing: "0.04em",
              padding: "3px 9px",
              borderRadius: 999,
              color: IS_MAINNET ? C.ok : C.warn,
              background: IS_MAINNET ? C.okSoft : C.warnSoft,
              border: `1px solid ${IS_MAINNET ? "#c4e0d0" : "#ecdcab"}`,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: IS_MAINNET ? C.ok : C.warn,
              }}
            />
            Sui · {NET_LABEL}
          </span>
        </div>
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
            <div
              style={{
                fontSize: 11,
                fontFamily: FM,
                color: C.textFaint,
                textTransform: "uppercase",
                letterSpacing: 0.4,
                marginBottom: 8,
              }}
            >
              SUI balance{" "}
              <span style={{ textTransform: "none", color: C.textFaint }}>· gas</span>
            </div>
            <div style={{ fontFamily: FM, fontSize: 15, color: C.text, marginBottom: 14 }}>
              {sui === null ? "—" : `${sui} SUI`}{" "}
              {sui === "0.0000" && (
                <a
                  href={IS_MAINNET ? "#" : "https://faucet.sui.io"}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11, color: C.accent }}
                >
                  faucet ↗
                </a>
              )}
            </div>
            {USDC_PAY_ENABLED && (
              <>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: FM,
                    color: C.textFaint,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                    marginBottom: 8,
                  }}
                >
                  USDC balance
                </div>
                <div style={{ fontFamily: FM, fontSize: 15, color: C.text, marginBottom: 14 }}>
                  {usdc === null ? "—" : `${usdc} USDC`}{" "}
                  {usdc === "0.00" && (
                    <a
                      href="https://faucet.circle.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: C.accent }}
                    >
                      faucet ↗
                    </a>
                  )}
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn onClick={copy}>{copied ? "Copied ✓" : "Copy address"}</Btn>
              <Link href="/me/points" style={{ textDecoration: "none" }}>
                <Btn>View points</Btn>
              </Link>
            </div>
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 14, lineHeight: 1.5 }}>
              Sui testnet. Personas are anchored on-chain as Sui objects with
              Seal-encrypted memory on Walrus — open any persona to see its
              object + blob. Reward balance + settlement activity appear here
              once the settlement layer is live.
            </div>
          </Card>
        )}
      </div>
    </Frame>
  );
}
