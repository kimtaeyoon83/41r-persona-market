"use client";

// Phase 4 §1 — Privy single-auth wrapper.
//
// Replaces the autotest-era SolanaWalletProvider + EvmWalletProvider
// stack. One PrivyProvider handles Email / Google / Phantom / Solflare
// / Discord / X login + optional embedded wallet creation.
//
// Why a separate Client Component instead of inlining in layout.tsx?
// Next.js 14 app router treats `layout.tsx` as a Server Component by
// default, but PrivyProvider uses React Context + hooks → must be in
// a Client Component. This file is the boundary.

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { defaultSolanaRpcsPlugin } from "@privy-io/react-auth/solana";
import { useEffect, type ReactNode } from "react";
import { setAuthTokenGetter } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";

// Inline default — Privy app id is client-side public (every browser
// DevTools shows it on first page load), so committing the constant
// is no leak. Server-only secret is PRIVY_APP_SECRET (Railway env).
// We previously tried Dockerfile ARG default + Railway service env;
// neither reliably reached `next build`, leaving appId undefined and
// the login modal as a no-op.
const PRIVY_APP_ID =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmor17hr1005w0dl1nnqmhhsy";

export function Providers({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) {
    // During local dev without env wired, render a no-auth shell so
    // pages still load. In prod this branch should never hit because
    // Railway always has the var set.
    if (typeof window !== "undefined") {
      console.warn(
        "[Privy] NEXT_PUBLIC_PRIVY_APP_ID is not set — auth disabled. " +
          "Pages render but login does nothing.",
      );
    }
    return <I18nProvider>{children}</I18nProvider>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Login surface — order matters for the modal.
        loginMethodsAndOrder: {
          primary: ["email", "google", "phantom"],
        },
        // Auto-create a Solana embedded wallet for users who sign in
        // via email/Google (no external wallet). Phantom users keep
        // their existing wallet. Decision §6.1 step 3.
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "users-without-wallets" },
        },
        // Register Privy's default Solana RPC config (mainnet +
        // devnet endpoints from solana-{cluster}.rpc.privy.systems).
        // Without this plugin, useSignTransaction throws
        // "No RPC configuration found for chain solana:devnet" when
        // we pass chain='solana:devnet' for the sponsored 0 USDC tx.
        plugins: [defaultSolanaRpcsPlugin()],
        appearance: {
          theme: "light",
          accentColor: "#14F195", // Solana / 41R green
          showWalletLoginFirst: false,
        },
      }}
    >
      <I18nProvider>
        <AuthBridge>{children}</AuthBridge>
      </I18nProvider>
    </PrivyProvider>
  );
}

// Wires Privy's getAccessToken into lib/api.ts so every request()
// auto-attaches `Authorization: Bearer <token>`. Effect-only — renders
// children unchanged.
function AuthBridge({ children }: { children: ReactNode }) {
  const { getAccessToken } = usePrivy();
  // Wire the getter UNCONDITIONALLY on mount (not gated on
  // ready/authenticated). React runs child effects before parent
  // effects, so a deep-linked authed page (e.g. /console/sites/[id])
  // would otherwise fire its data load before this parent effect set
  // the getter — sending the request with no bearer → 401
  // missing_bearer_token. getAccessToken() itself returns null when
  // not authenticated, so request() simply omits the header until a
  // token exists. (2026-06-16 deep-link auth fix.)
  useEffect(() => {
    setAuthTokenGetter(() => getAccessToken());
    return () => setAuthTokenGetter(null);
  }, [getAccessToken]);
  return <>{children}</>;
}
