import { lazy, Suspense, type ReactNode } from 'react';

const LayoutRuntime = lazy(() => import('./LayoutRuntime'));

function LayoutLoadingShell() {
  return (
    <main className="grid min-h-screen place-items-center dawaa-app-bg p-5" dir="rtl">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--dawaa-theme-primary)] border-t-transparent" />
        <p className="dawaa-muted text-sm font-bold">جاري تجهيز واجهة التطبيق…</p>
      </div>
    </main>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LayoutLoadingShell />}>
      <LayoutRuntime>{children}</LayoutRuntime>
    </Suspense>
  );
}
