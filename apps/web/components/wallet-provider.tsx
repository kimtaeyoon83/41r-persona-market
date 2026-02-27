"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

interface WalletContextType {
  publicKey: string | null;
  connecting: boolean;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType>({
  publicKey: null,
  connecting: false,
  connected: false,
  connect: async () => {},
  disconnect: async () => {},
});

export function useWalletContext() {
  return useContext(WalletContext);
}

function getPhantom(): { solana?: { isPhantom?: boolean; connect: () => Promise<{ publicKey: { toBase58: () => string } }>; disconnect: () => Promise<void>; on: (event: string, cb: () => void) => void; publicKey?: { toBase58: () => string } | null } } | undefined {
  if (typeof window !== "undefined") {
    return (window as unknown as { phantom?: { solana?: { isPhantom?: boolean; connect: () => Promise<{ publicKey: { toBase58: () => string } }>; disconnect: () => Promise<void>; on: (event: string, cb: () => void) => void; publicKey?: { toBase58: () => string } | null } } }).phantom;
  }
  return undefined;
}

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Check if already connected on mount
  useEffect(() => {
    const phantom = getPhantom();
    if (phantom?.solana?.isPhantom && phantom.solana.publicKey) {
      setPublicKey(phantom.solana.publicKey.toBase58());
    }
  }, []);

  // Listen for account changes
  useEffect(() => {
    const phantom = getPhantom();
    if (!phantom?.solana) return;

    phantom.solana.on("accountChanged", () => {
      const pk = phantom.solana?.publicKey;
      setPublicKey(pk ? pk.toBase58() : null);
    });

    phantom.solana.on("disconnect", () => {
      setPublicKey(null);
    });
  }, []);

  const connect = useCallback(async () => {
    const phantom = getPhantom();
    if (!phantom?.solana?.isPhantom) {
      window.open("https://phantom.app/", "_blank");
      return;
    }
    setConnecting(true);
    try {
      const resp = await phantom.solana.connect();
      setPublicKey(resp.publicKey.toBase58());
    } catch {
      // User rejected
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const phantom = getPhantom();
    if (phantom?.solana) {
      await phantom.solana.disconnect();
    }
    setPublicKey(null);
  }, []);

  return (
    <WalletContext.Provider value={{ publicKey, connecting, connected: !!publicKey, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}
