"use client";

interface TxLinkProps {
  txSignature: string;
  label?: string;
}

export function TxLink({ txSignature, label }: TxLinkProps) {
  const displayLabel = label || `${txSignature.slice(0, 8)}...${txSignature.slice(-6)}`;
  const href = `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sol-green hover:text-sol-green/80 transition-colors group"
    >
      <span className="font-mono text-xs">{displayLabel}</span>
      <svg
        className="w-3 h-3 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </a>
  );
}
