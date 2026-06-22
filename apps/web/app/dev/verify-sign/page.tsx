"use client";

// Dev harness — Privy signMessage live verification (the one open gate on
// user-side Sui/USDC transfer; see lib/sui-wallet.ts STATUS note).
//
// The Sui signing path raw-signs blake2b256(intent) (a 32-byte digest) with
// the user's Privy embedded Ed25519 ("Solana") wallet, then re-wraps the
// 64-byte signature into Sui's serialized form. scripts/verify-sui-sign.ts
// already proved our assembly is byte-identical to the SDK + accepted on
// testnet. The ONLY unverified piece is Privy-internal: does its signMessage
// raw-sign the exact 32 bytes we pass (correct → Sui accepts) or transform
// them first (prefix/hash → breaks)?
//
// This page answers it with a real in-browser Privy session, gas-free:
//   1. random 32-byte digest D
//   2. sig = privy.signMessage({ message: D, wallet })   ← real Privy call
//   3. ok  = ed25519.verify(sig, D, pubkey)              ← via Sui SDK
// ok === true  → Privy raw-signs → safe to set NEXT_PUBLIC_USDC_ENABLED=1.
// ok === false → Privy transforms the message → the USDC path must NOT ship.
//
// Not linked in nav; open /dev/verify-sign directly while logged in.

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useWallets as useSolanaWallets,
  useSignMessage,
  useCreateWallet,
} from "@privy-io/react-auth/solana";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import bs58 from "bs58";
import { deriveSuiAddress } from "@/lib/sui-wallet";
import { C, FS, FM, Frame } from "../../validator/_components/ui";

const hex = (u: Uint8Array) =>
  Array.from(u)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

type Result = {
  digestHex: string;
  sigHex: string;
  solanaAddr: string;
  suiAddr: string;
  rawVerify: boolean;
};

export default function VerifySignPage() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { signMessage } = useSignMessage();
  const { createWallet } = useCreateWallet();
  const [running, setRunning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const wallet = wallets[0] ?? null;

  const run = async () => {
    setError(null);
    setResult(null);
    if (!wallet) {
      setError("No Solana embedded wallet on this account.");
      return;
    }
    setRunning(true);
    try {
      // 1) random 32-byte digest — stand-in for blake2b256(intent message)
      const digest = new Uint8Array(32);
      crypto.getRandomValues(digest);

      // 2) the real Privy call — sign the raw 32 bytes
      const { signature } = await signMessage({ message: digest, wallet });

      // 3) verify the signature is a valid Ed25519 sig OVER those exact bytes.
      //    Ed25519PublicKey.verify(msg, rawSigBytes) runs ed25519.verify
      //    directly when passed raw bytes (no intent, no re-hash).
      const pubkey = new Ed25519PublicKey(bs58.decode(wallet.address));
      const rawVerify = await pubkey.verify(digest, signature);

      setResult({
        digestHex: hex(digest),
        sigHex: hex(signature),
        solanaAddr: wallet.address,
        suiAddr: pubkey.toSuiAddress(),
        rawVerify,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "signMessage failed");
    } finally {
      setRunning(false);
    }
  };

  const make = async () => {
    setError(null);
    setCreating(true);
    try {
      await createWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "wallet creation failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Frame>
      <div className="v-page-pad" style={{ maxWidth: 760, margin: "0 auto" }}>
        <div
          style={{
            fontFamily: FM,
            fontSize: 11,
            color: C.textFaint,
            letterSpacing: "0.1em",
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          Dev · chain
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 600, fontFamily: FS, margin: "0 0 8px" }}>
          Privy signMessage — live verify
        </h1>
        <p style={{ fontSize: 13.5, color: C.textDim, lineHeight: 1.6, margin: "0 0 22px" }}>
          The last gate on user-side Sui/USDC transfer. This signs a random
          32-byte digest with your Privy embedded wallet and checks the result
          is a valid Ed25519 signature over those exact bytes. PASS → Privy
          raw-signs → safe to enable{" "}
          <code style={{ fontFamily: FM }}>NEXT_PUBLIC_USDC_ENABLED=1</code>.
        </p>

        {!ready ? (
          <div style={{ fontSize: 13, color: C.textDim }}>Loading…</div>
        ) : !authenticated ? (
          <button onClick={login} style={btn(C.text, C.bg)}>
            Sign in to run
          </button>
        ) : !wallet ? (
          <div>
            <div style={{ fontSize: 13, color: C.textDim, marginBottom: 12 }}>
              No Solana embedded wallet yet on this account.
            </div>
            <button onClick={make} disabled={creating} style={btn(C.accent, "#fff")}>
              {creating ? "Creating…" : "Create embedded wallet"}
            </button>
          </div>
        ) : (
          <div>
            <div
              style={{
                fontFamily: FM,
                fontSize: 12,
                color: C.textDim,
                marginBottom: 16,
                lineHeight: 1.7,
                wordBreak: "break-all",
              }}
            >
              <div>solana: {wallet.address}</div>
              <div>
                sui:&nbsp;&nbsp;&nbsp;
                {(() => {
                  try {
                    return deriveSuiAddress(wallet.address);
                  } catch {
                    return "—";
                  }
                })()}
              </div>
            </div>
            <button onClick={run} disabled={running} style={btn(C.text, C.bg)}>
              {running ? "Signing… (approve in the Privy modal)" : "Run verification"}
            </button>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 18, color: C.bad, fontSize: 13, fontFamily: FM }}>
            error: {error}
          </div>
        )}

        {result && (
          <div
            style={{
              marginTop: 24,
              padding: 18,
              borderRadius: 12,
              border: `1px solid ${result.rawVerify ? "#c4e0d0" : "#f3cabf"}`,
              background: result.rawVerify ? C.okSoft : C.badSoft,
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                fontFamily: FS,
                color: result.rawVerify ? C.ok : C.bad,
                marginBottom: 10,
              }}
            >
              {result.rawVerify
                ? "✓ PASS — Privy raw-signs the digest"
                : "✗ FAIL — Privy transformed the message"}
            </div>
            <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6, marginBottom: 14 }}>
              {result.rawVerify
                ? "ed25519.verify(sig, digest, pubkey) = true. Sui will accept signatures produced by signAndExecuteSuiTx. Safe to set NEXT_PUBLIC_USDC_ENABLED=1."
                : "ed25519.verify(sig, digest, pubkey) = false — Privy hashed/prefixed the bytes before signing. The Sui transfer path must stay gated; do NOT enable USDC."}
            </div>
            <div
              style={{
                fontFamily: FM,
                fontSize: 11,
                color: C.textDim,
                lineHeight: 1.7,
                wordBreak: "break-all",
              }}
            >
              <div>digest (32B): {result.digestHex}</div>
              <div>signature (64B): {result.sigHex}</div>
              <div>sui address: {result.suiAddr}</div>
              <div>raw ed25519 verify: {String(result.rawVerify)}</div>
            </div>
          </div>
        )}
      </div>
    </Frame>
  );
}

function btn(bg: string, fg: string): React.CSSProperties {
  return {
    background: bg,
    color: fg,
    border: "none",
    borderRadius: 999,
    padding: "11px 22px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FS,
  };
}
