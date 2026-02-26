"use client";

type SasTier = "Bronze" | "Silver" | "Gold";

interface SasBadgeProps {
  tier: SasTier;
  attestId?: string;
}

const tierConfig: Record<SasTier, { bg: string; text: string; border: string; glow: string }> = {
  Bronze: {
    bg: "bg-amber-700/15",
    text: "text-amber-500",
    border: "border-amber-600/30",
    glow: "shadow-amber-600/10",
  },
  Silver: {
    bg: "bg-slate-300/10",
    text: "text-slate-300",
    border: "border-slate-400/30",
    glow: "shadow-slate-400/10",
  },
  Gold: {
    bg: "bg-yellow-400/10",
    text: "text-yellow-400",
    border: "border-yellow-400/30",
    glow: "shadow-yellow-400/10",
  },
};

export function SasBadge({ tier, attestId }: SasBadgeProps) {
  const config = tierConfig[tier];

  const badge = (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border shadow-sm ${config.bg} ${config.text} ${config.border} ${config.glow}`}
    >
      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
      SAS {tier}
      {attestId && (
        <svg
          className="w-3 h-3 ml-0.5 opacity-60"
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
      )}
    </span>
  );

  if (attestId) {
    return (
      <a
        href={`https://explorer.solana.com/tx/${attestId}?cluster=devnet`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block hover:opacity-80 transition-opacity"
      >
        {badge}
      </a>
    );
  }

  return badge;
}
