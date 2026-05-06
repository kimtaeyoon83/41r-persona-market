"use client";

// /me/wallet — Privy embedded Solana wallet panel.
//
// Shows the user's wallet address + SOL/USDC balances + simple send
// flow. Network: Solana Devnet (matches the rest of 41R per CLAUDE.md).
// Embedded wallet is auto-created at login via providers.tsx config
// (`embeddedWallets.solana.createOnLogin: 'users-without-wallets'`).
//
// Sends use Privy's useSignTransaction — same pattern as the
// sponsored-tx scan flow on /validator/detail.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Btn, C, Card, FM, FS, Frame, Pill } from "../../validator/_components/ui";

// Devnet — see CLAUDE.md. USDC devnet mint is the standard 41R one.
const RPC_URL = "https://api.devnet.solana.com";
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

type Balances = {
  sol: number | null;
  usdc: number | null;
};

export default function WalletPage() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();

  const wallet = wallets[0];
  const address = wallet?.address ?? null;

  const [bal, setBal] = useState<Balances>({ sol: null, usdc: null });
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Send form
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    setRefreshing(true);
    try {
      const conn = new Connection(RPC_URL, "confirmed");
      const pk = new PublicKey(address);
      const [solLamports, usdcAccs] = await Promise.all([
        conn.getBalance(pk),
        conn
          .getParsedTokenAccountsByOwner(pk, { mint: new PublicKey(USDC_MINT) })
          .catch(() => ({ value: [] as Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }> })),
      ]);
      const usdcUi =
        usdcAccs.value[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      setBal({
        sol: solLamports / LAMPORTS_PER_SOL,
        usdc: usdcUi,
      });
    } catch {
      // Silent fail — leave previous balance, user can hit Refresh
    } finally {
      setRefreshing(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSend() {
    if (!wallet || !address || sending) return;
    setError(null);
    setTxSig(null);
    const trimmedAddr = recipient.trim();
    const parsedAmount = parseFloat(amount);
    if (!trimmedAddr) {
      setError("Recipient address required");
      return;
    }
    if (!parsedAmount || parsedAmount <= 0) {
      setError("Amount must be > 0");
      return;
    }
    let toPk: PublicKey;
    try {
      toPk = new PublicKey(trimmedAddr);
    } catch {
      setError("Invalid Solana address");
      return;
    }
    const lamports = Math.round(parsedAmount * LAMPORTS_PER_SOL);
    if ((bal.sol ?? 0) * LAMPORTS_PER_SOL < lamports + 5000) {
      setError("Insufficient SOL (need amount + ~0.000005 fee)");
      return;
    }
    setSending(true);
    try {
      const conn = new Connection(RPC_URL, "confirmed");
      const fromPk = new PublicKey(address);
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: fromPk,
        recentBlockhash: blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: fromPk,
          toPubkey: toPk,
          lamports,
        }),
      );
      const txBytes = tx.serialize({ requireAllSignatures: false });
      const { signedTransaction } = await signTransaction({
        transaction: txBytes,
        wallet,
        // Privy default chain is solana:mainnet; we run on devnet.
        chain: 'solana:devnet',
      });
      const sig = await conn.sendRawTransaction(signedTransaction);
      await conn.confirmTransaction(sig, "confirmed");
      setTxSig(sig);
      setRecipient("");
      setAmount("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  if (!ready) {
    return (
      <Frame>
        <div className="v-page-pad" style={{ maxWidth: 680, margin: "0 auto" }}>
          <div style={{ fontSize: 13, color: C.textDim }}>Loading wallet…</div>
        </div>
      </Frame>
    );
  }

  if (!authenticated) {
    return (
      <Frame>
        <div className="v-page-pad" style={{ maxWidth: 680, margin: "0 auto" }}>
          <h1
            style={{
              fontSize: "clamp(22px, 5vw, 28px)",
              fontWeight: 600,
              margin: "0 0 12px",
              letterSpacing: "-0.02em",
            }}
          >
            Wallet
          </h1>
          <Card>
            <div style={{ fontSize: 13, color: C.textDim, marginBottom: 14 }}>
              Sign in to view your Solana wallet, SOL / USDC balance, and
              send funds.
            </div>
            <Btn primary onClick={() => login()}>
              Sign in
            </Btn>
          </Card>
        </div>
      </Frame>
    );
  }

  if (!address) {
    return (
      <Frame>
        <div className="v-page-pad" style={{ maxWidth: 680, margin: "0 auto" }}>
          <Card>
            <div style={{ fontSize: 13, color: C.textDim }}>
              No Solana wallet linked. The embedded wallet is normally
              auto-created at login — try logging out and back in.
            </div>
          </Card>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="v-page-pad" style={{ maxWidth: 680, margin: "0 auto" }}>
        <div style={{ marginBottom: 14 }}>
          <Link
            href="/"
            style={{
              fontSize: 12,
              color: C.textFaint,
              fontFamily: FM,
              textDecoration: "none",
            }}
          >
            ← Home
          </Link>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <h1
            style={{
              fontSize: "clamp(22px, 5vw, 28px)",
              fontWeight: 600,
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Wallet
          </h1>
          <Pill>Solana · Devnet</Pill>
        </div>

        {/* Address card */}
        <Card style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              fontFamily: FM,
              color: C.textFaint,
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            ADDRESS
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <code
              style={{
                fontFamily: FM,
                fontSize: 12,
                color: C.text,
                background: "#f3f0e8",
                padding: "4px 8px",
                borderRadius: 6,
                wordBreak: "break-all",
                flex: 1,
                minWidth: 0,
              }}
            >
              {address}
            </code>
            <Btn onClick={copyAddress}>{copied ? "✓ Copied" : "Copy"}</Btn>
          </div>
          <div style={{ fontSize: 11, color: C.textFaint, marginTop: 8 }}>
            View on{" "}
            <a
              href={`https://solscan.io/account/${address}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.accent, textDecoration: "underline" }}
            >
              Solscan ↗
            </a>
          </div>
        </Card>

        {/* Balances card */}
        <Card style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontFamily: FM,
                color: C.textFaint,
                letterSpacing: "0.06em",
              }}
            >
              BALANCES
            </div>
            <button
              onClick={refresh}
              disabled={refreshing}
              style={{
                background: "transparent",
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: "3px 10px",
                fontSize: 11,
                fontFamily: FM,
                color: C.textDim,
                cursor: refreshing ? "wait" : "pointer",
              }}
            >
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <div
                style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}
              >
                SOL
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: C.text,
                  fontFamily: FM,
                  marginTop: 2,
                }}
              >
                {bal.sol == null ? "—" : bal.sol.toFixed(4)}
              </div>
            </div>
            <div>
              <div
                style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}
              >
                USDC
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: C.text,
                  fontFamily: FM,
                  marginTop: 2,
                }}
              >
                {bal.usdc == null ? "—" : bal.usdc.toFixed(2)}
              </div>
            </div>
          </div>
          {bal.sol === 0 && (
            <div
              style={{
                fontSize: 12,
                color: C.textFaint,
                marginTop: 12,
                lineHeight: 1.5,
              }}
            >
              Need devnet SOL? Visit{" "}
              <a
                href="https://faucet.solana.com/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: C.accent, textDecoration: "underline" }}
              >
                faucet.solana.com ↗
              </a>{" "}
              and paste the address above.
            </div>
          )}
        </Card>

        {/* Send card */}
        <Card>
          <div
            style={{
              fontSize: 11,
              fontFamily: FM,
              color: C.textFaint,
              letterSpacing: "0.06em",
              marginBottom: 12,
            }}
          >
            SEND SOL
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label
                style={{
                  fontSize: 11,
                  color: C.textDim,
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Recipient address
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Solana public key"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 13,
                  fontFamily: FM,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  background: C.panel,
                  color: C.text,
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  fontSize: 11,
                  color: C.textDim,
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Amount (SOL)
              </label>
              <input
                type="number"
                step="0.0001"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.01"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 13,
                  fontFamily: FM,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  background: C.panel,
                  color: C.text,
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn
                primary
                onClick={handleSend}
                style={{ opacity: sending ? 0.6 : 1 }}
              >
                {sending ? "Sending…" : "Send"}
              </Btn>
              {txSig && (
                <a
                  href={`https://solscan.io/tx/${txSig}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 12,
                    fontFamily: FM,
                    color: C.ok,
                    textDecoration: "underline",
                    alignSelf: "center",
                  }}
                >
                  ✓ Sent — view tx ↗
                </a>
              )}
            </div>
            {error && (
              <div
                style={{
                  fontSize: 12,
                  color: C.bad,
                  background: C.badSoft,
                  border: `1px solid ${C.bad}33`,
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontFamily: FS,
                }}
              >
                {error}
              </div>
            )}
          </div>
          <div
            style={{
              fontSize: 11,
              color: C.textFaint,
              marginTop: 12,
              lineHeight: 1.5,
            }}
          >
            USDC send not yet supported in this UI. SOL transfers go through
            your Privy embedded wallet on Solana Devnet.
          </div>
        </Card>
      </div>
    </Frame>
  );
}
