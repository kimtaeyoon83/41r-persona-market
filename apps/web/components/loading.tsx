"use client";

interface LoadingProps {
  message?: string;
  variant?: "spinner" | "skeleton" | "dots";
}

export function Loading({ message, variant = "spinner" }: LoadingProps) {
  if (variant === "skeleton") {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-surface-card rounded-lg" />
        <div className="h-4 w-72 bg-surface-elevated rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="h-48 bg-surface-card rounded-xl border border-border-dim" />
          <div className="h-48 bg-surface-card rounded-xl border border-border-dim" />
          <div className="h-48 bg-surface-card rounded-xl border border-border-dim" />
          <div className="h-48 bg-surface-card rounded-xl border border-border-dim" />
        </div>
      </div>
    );
  }

  if (variant === "dots") {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-sol-green animate-bounce [animation-delay:-0.3s]" />
          <div className="w-2 h-2 rounded-full bg-sol-purple animate-bounce [animation-delay:-0.15s]" />
          <div className="w-2 h-2 rounded-full bg-sol-blue animate-bounce" />
        </div>
        {message && <p className="text-sm text-[var(--text-secondary)]">{message}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border-2 border-border-dim" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-sol-green animate-spin" />
      </div>
      {message && <p className="text-sm text-[var(--text-secondary)]">{message}</p>}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="p-5 rounded-xl border border-border-dim bg-surface animate-pulse">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="h-3 w-20 bg-surface-card rounded mb-2" />
          <div className="flex gap-2">
            <div className="h-5 w-16 bg-surface-elevated rounded-full" />
            <div className="h-5 w-16 bg-surface-elevated rounded-full" />
          </div>
        </div>
        <div className="h-5 w-10 bg-surface-elevated rounded" />
      </div>
      <div className="h-3 w-full bg-surface-card rounded mt-3" />
      <div className="h-3 w-2/3 bg-surface-card rounded mt-2" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-4 rounded-xl border border-border-dim bg-surface flex justify-between items-center">
          <div className="flex-1">
            <div className="h-4 w-48 bg-surface-card rounded mb-2" />
            <div className="h-3 w-32 bg-surface-elevated rounded" />
          </div>
          <div className="h-6 w-20 bg-surface-elevated rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function LoadingSpinner({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="w-8 h-8 border-2 border-border-dim border-t-sol-green rounded-full animate-spin" />
      <p className="text-sm text-[var(--text-tertiary)]">{text}</p>
    </div>
  );
}

export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-surface-card rounded" style={{ width: `${85 - i * 15}%` }} />
      ))}
    </div>
  );
}
