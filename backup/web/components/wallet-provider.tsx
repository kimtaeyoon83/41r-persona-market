"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

interface WalletContextType {
  publicKey: string | null;
  connecting: boolean;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Sign a plain-text message with the connected wallet. Returns base58 signature. */
  signMessage: (message: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextType>({
  publicKey: null,
  connecting: false,
  connected: false,
  connect: async () => {},
  disconnect: async () => {},
  signMessage: async () => { throw new Error('Wallet not connected'); },
});

export function useWalletContext() {
  return useContext(WalletContext);
}

type PhantomSolana = {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: { toBase58: () => string } }>;
  disconnect: () => Promise<void>;
  on: (event: string, cb: () => void) => void;
  publicKey?: { toBase58: () => string } | null;
  signMessage?: (msg: Uint8Array, display?: 'utf8' | 'hex') => Promise<{ signature: Uint8Array }>;
};

function getPhantom(): { solana?: PhantomSolana } | undefined {
  if (typeof window !== "undefined") {
    return (window as unknown as { phantom?: { solana?: PhantomSolana } }).phantom;
  }
  return undefined;
}

function toBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  // Minimal base58 encoder — sufficient for 64-byte ed25519 signatures.
  let num = 0n;
  for (const b of bytes) num = (num << 8n) + BigInt(b);
  let out = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    num = num / 58n;
    out = alphabet[rem] + out;
  }
  // Preserve leading zero bytes as leading '1's.
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
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

  const signMessage = useCallback(async (message: string): Promise<string> => {
    const phantom = getPhantom();
    if (!phantom?.solana?.signMessage) {
      throw new Error('Wallet does not support signMessage');
    }
    const encoded = new TextEncoder().encode(message);
    const { signature } = await phantom.solana.signMessage(encoded, 'utf8');
    return toBase58(signature);
  }, []);

  return (
    <WalletContext.Provider value={{ publicKey, connecting, connected: !!publicKey, connect, disconnect, signMessage }}>
      {children}
    </WalletContext.Provider>
  );
}
