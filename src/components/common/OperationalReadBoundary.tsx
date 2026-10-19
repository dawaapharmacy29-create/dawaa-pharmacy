import type { ReactNode } from 'react';

/** A pending or failed read is not a confirmed empty operational result. */
export default function OperationalReadBoundary({
  loading, error, label, children,
}: { loading: boolean; error?: string | null; label: string; children?: ReactNode }) {
  if (loading) return <div role="status" aria-busy="true" className="p-3 text-sm text-[var(--dawaa-theme-muted)]">جارٍ تحميل {label}...</div>;
  if (error) return <div role="status" className="p-3 text-sm text-[var(--dawaa-theme-muted)]">{label} غير متاحة حاليًا</div>;
  return <>{children}</>;
}
