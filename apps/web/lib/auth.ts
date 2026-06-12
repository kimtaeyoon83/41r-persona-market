"use client";

// Auth hook wrapper (E2E dev bypass, 2026-06-12).
//
// Console/me screens read auth state through this instead of
// usePrivy() directly so local E2E can run headless:
// NEXT_PUBLIC_DEV_AUTH_BYPASS=1 short-circuits to an authenticated
// state and lib/api.ts attaches `x-dev-user-email` (the API side
// honors it only when ITS DEV_AUTH_BYPASS=1 and never in production
// — see apps/api/src/middleware/privy_auth.ts). Without the env this
// is a zero-cost passthrough to Privy.

import { usePrivy } from "@privy-io/react-auth";

export const DEV_AUTH_BYPASS =
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1";

/** Email the bypass session impersonates — mirrored by lib/api.ts. */
export const DEV_USER_EMAIL = "e2e@41r.local";

type AuthState = {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  logout: () => void;
  /** Display identity for the TopBar tooltip. */
  identityLabel: string | null;
};

export function useAuth(): AuthState {
  // Hook order is stable: usePrivy is called unconditionally; the
  // bypass only overrides the returned values.
  const { ready, authenticated, login, logout, user } = usePrivy();
  if (DEV_AUTH_BYPASS) {
    return {
      ready: true,
      authenticated: true,
      login: () => {},
      logout: () => {},
      identityLabel: DEV_USER_EMAIL,
    };
  }
  return {
    ready,
    authenticated,
    login,
    logout,
    identityLabel: user?.email?.address ?? user?.wallet?.address ?? null,
  };
}
