"use client";

import { useMemo, type ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { bscTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const BSC_RPC = process.env.NEXT_PUBLIC_BSC_RPC_URL ?? bscTestnet.rpcUrls.default.http[0];

type Eip1193 = {
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isBraveWallet?: boolean;
  isRabby?: boolean;
  providers?: Eip1193[];
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

/**
 * Pick the MetaMask provider even when Phantom/Brave/etc. have hijacked
 * window.ethereum. Checks window.ethereum.providers[] first (classic injected
 * multi-wallet), then the single-provider case. We reject providers that are
 * flagged as Phantom/Brave/Rabby even if they also claim isMetaMask.
 */
function findMetaMaskProvider(win: unknown): Eip1193 | undefined {
  if (!win || typeof win !== "object") return undefined;
  const root = (win as { ethereum?: Eip1193 }).ethereum;
  if (!root) return undefined;

  const isRealMetaMask = (p: Eip1193 | undefined): p is Eip1193 =>
    !!p?.isMetaMask && !p.isPhantom && !p.isBraveWallet && !p.isRabby;

  if (Array.isArray(root.providers)) {
    const mm = root.providers.find(isRealMetaMask);
    if (mm) return mm;
  }
  if (isRealMetaMask(root)) return root;
  return undefined;
}

export function EvmWalletProvider({ children }: { children: ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), []);
  const config = useMemo(
    () =>
      createConfig({
        chains: [bscTestnet],
        connectors: [
          injected({
            target() {
              return {
                id: "metaMask",
                name: "MetaMask",
                provider: (win: unknown) => findMetaMaskProvider(win) as never,
              };
            },
          }),
        ],
        transports: { [bscTestnet.id]: http(BSC_RPC) },
        ssr: true,
      }),
    [],
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
