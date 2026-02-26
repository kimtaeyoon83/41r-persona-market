"use client";

interface LoadingProps {
  message?: string;
  variant?: "spinner" | "skeleton" | "dots";
}

export function Loading({ message, variant = "spinner" }: LoadingProps) {
  if (variant === "skeleton") {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-gray-800 rounded-lg" />
        <div className="h-4 w-72 bg-gray-800/60 rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="h-48 bg-gray-800/40 rounded-lg border border-gray-800" />
          <div className="h-48 bg-gray-800/40 rounded-lg border border-gray-800" />
          <div className="h-48 bg-gray-800/40 rounded-lg border border-gray-800" />
          <div className="h-48 bg-gray-800/40 rounded-lg border border-gray-800" />
        </div>
      </div>
    );
  }

  if (variant === "dots") {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce [animation-delay:-0.3s]" />
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.15s]" />
          <div className="w-2 h-2 rounded-full bg-green-400 animate-bounce" />
        </div>
        {message && <p className="text-sm text-gray-400">{message}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border-2 border-gray-800" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-purple-400 animate-spin" />
      </div>
      {message && <p className="text-sm text-gray-400">{message}</p>}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="p-5 rounded-lg border border-gray-800 bg-gray-900 animate-pulse">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="h-3 w-20 bg-gray-800 rounded mb-2" />
          <div className="flex gap-2">
            <div className="h-5 w-16 bg-gray-800/60 rounded-full" />
            <div className="h-5 w-16 bg-gray-800/60 rounded-full" />
          </div>
        </div>
        <div className="h-5 w-10 bg-gray-800/60 rounded" />
      </div>
      <div className="h-3 w-full bg-gray-800/40 rounded mt-3" />
      <div className="h-3 w-2/3 bg-gray-800/40 rounded mt-2" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-4 rounded-lg border border-gray-800 bg-gray-900 flex justify-between items-center">
          <div className="flex-1">
            <div className="h-4 w-48 bg-gray-800 rounded mb-2" />
            <div className="h-3 w-32 bg-gray-800/40 rounded" />
          </div>
          <div className="h-6 w-20 bg-gray-800/60 rounded-full" />
        </div>
      ))}
    </div>
  );
}
