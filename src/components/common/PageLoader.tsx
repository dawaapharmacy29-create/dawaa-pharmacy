import { LOGO_URL } from "@/lib/constants";

interface PageLoaderProps {
  message?: string;
}

export default function PageLoader({ message = "جاري التحميل..." }: PageLoaderProps) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-4"
      style={{ background: "var(--dawaa-theme-bg)", color: "var(--dawaa-theme-text)" }}
      dir="rtl"
    >
      <img
        src={LOGO_URL}
        alt="Dawaa"
        className="w-14 h-14 rounded-2xl object-contain animate-pulse-soft"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <div
        className="w-8 h-8 rounded-full border-3 animate-spin"
        style={{
          borderColor: "var(--dawaa-theme-border)",
          borderTopColor: "var(--dawaa-theme-primary)",
        }}
      />
      <p className="text-sm" style={{ color: "var(--dawaa-theme-muted)" }}>
        {message}
      </p>
    </div>
  );
}

/**
 * Inline section loader — smaller, for within-page loading states.
 */
export function SectionLoader({ message = "جاري التحميل..." }: PageLoaderProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16"
      dir="rtl"
    >
      <div
        className="w-6 h-6 rounded-full border-2 animate-spin"
        style={{
          borderColor: "var(--dawaa-theme-border)",
          borderTopColor: "var(--dawaa-theme-primary)",
        }}
      />
      <p className="text-sm" style={{ color: "var(--dawaa-theme-muted)" }}>
        {message}
      </p>
    </div>
  );
}

/**
 * Skeleton loader for card-style content.
 */
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" dir="rtl">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl p-6 animate-pulse"
          style={{ background: "var(--dawaa-theme-surface)" }}
        >
          <div
            className="h-4 rounded mb-3 w-3/4"
            style={{ background: "var(--dawaa-theme-surface-2)" }}
          />
          <div
            className="h-8 rounded mb-2 w-1/2"
            style={{ background: "var(--dawaa-theme-surface-2)" }}
          />
          <div
            className="h-3 rounded w-2/3"
            style={{ background: "var(--dawaa-theme-surface-2)" }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton loader for table rows.
 */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--dawaa-theme-surface)" }} dir="rtl">
      <div
        className="grid gap-4 px-4 py-3 border-b animate-pulse"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          borderColor: "var(--dawaa-theme-border)",
          background: "var(--dawaa-theme-table-head)",
        }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 rounded" style={{ background: "var(--dawaa-theme-surface-2)" }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid gap-4 px-4 py-4 border-b animate-pulse"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            borderColor: "var(--dawaa-theme-border)",
          }}
        >
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-3 rounded w-4/5" style={{ background: "var(--dawaa-theme-surface-2)" }} />
          ))}
        </div>
      ))}
    </div>
  );
}
