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

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

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
    return <>{children}</>;
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
        // Solana cluster pinning (devnet) is done in the Phase 4
        // sponsored-tx flow when constructing the Connection, not at
        // the provider level. Privy's embedded Solana wallet itself
        // is cluster-agnostic — it just signs.
        appearance: {
          theme: "light",
          accentColor: "#14F195", // Solana / 41R green
          showWalletLoginFirst: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
