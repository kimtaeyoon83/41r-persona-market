export function DevDemoBanner({ subtitle }: { subtitle?: string }) {
  return (
    <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
        <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-amber-300">Dev / Demo — not a production flow</p>
        {subtitle && (
          <p className="text-[12px] text-amber-200/70 mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
