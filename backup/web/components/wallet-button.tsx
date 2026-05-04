"use client";

import { useWalletContext } from "./wallet-provider";
import { useEffect, useRef, useState } from "react";

export function WalletButton() {
  const { publicKey, connect, disconnect, connecting } = useWalletContext();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (publicKey) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sol-green/8 border border-sol-green/20 hover:border-sol-green/40 transition-colors w-full"
        >
          <div className="w-2 h-2 rounded-full bg-sol-green" />
          <span className="text-[11px] font-mono text-sol-green truncate flex-1 text-left">
            {publicKey.slice(0, 4)}...{publicKey.slice(-4)}
          </span>
          <svg className="w-3 h-3 text-sol-green/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showDropdown && (
          <div className="absolute bottom-full left-0 right-0 mb-1 p-1 rounded-lg bg-surface-elevated border border-border-dim shadow-lg z-50">
            <button
              onClick={() => {
                navigator.clipboard.writeText(publicKey);
                setShowDropdown(false);
              }}
              className="w-full px-3 py-2 text-left text-[11px] font-mono text-[var(--text-secondary)] hover:bg-surface-card rounded-md transition-colors"
            >
              Copy Address
            </button>
            <button
              onClick={() => {
                disconnect();
                setShowDropdown(false);
              }}
              className="w-full px-3 py-2 text-left text-[11px] font-mono text-[var(--status-error)] hover:bg-surface-card rounded-md transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={connecting}
      className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border-dim hover:border-sol-purple/30 bg-surface-elevated hover:bg-surface-card transition-colors w-full"
    >
      {connecting ? (
        <div className="w-3.5 h-3.5 border-2 border-border-dim border-t-sol-purple rounded-full animate-spin" />
      ) : (
        <svg className="w-3.5 h-3.5 text-sol-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )}
      <span className="text-[11px] font-medium text-[var(--text-secondary)]">
        {connecting ? "Connecting..." : "Connect Wallet"}
      </span>
    </button>
  );
}
