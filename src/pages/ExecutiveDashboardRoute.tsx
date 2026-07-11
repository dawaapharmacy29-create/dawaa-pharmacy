import { useEffect, useState, type ComponentType } from 'react';
import ExecutiveDashboardSafe from '@/pages/ExecutiveDashboardSafe';
import { logRuntimeError } from '@/lib/appRecovery';

const DASHBOARD_IMPORT_TIMEOUT_MS = 8000;

type DashboardState =
  | { status: 'loading'; Component?: undefined; message?: undefined }
  | { status: 'ready'; Component: ComponentType; message?: undefined }
  | { status: 'safe'; Component?: undefined; message: string };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function DashboardLoadingShell() {
  return (
    <main className="space-y-6 text-slate-100" dir="rtl">
      <section className="rounded-2xl border border-teal-400/20 bg-slate-900 p-6">
        <div className="h-8 w-64 animate-pulse rounded-xl bg-slate-700/70" />
        <div className="mt-4 h-4 w-96 max-w-full animate-pulse rounded-xl bg-slate-800" />
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />
        ))}
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm font-bold text-slate-300">
        جاري تحميل لوحة القيادة المتقدمة... إذا تأخر التحميل سيتم فتح وضع الأمان تلقائيًا.
      </section>
    </main>
  );
}

export default function ExecutiveDashboardRoute() {
  const [state, setState] = useState<DashboardState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const module = await withTimeout(
          import('@/pages/ExecutiveDashboardProduction'),
          DASHBOARD_IMPORT_TIMEOUT_MS,
          'ExecutiveDashboardProduction import'
        );
        if (!cancelled) setState({ status: 'ready', Component: module.default });
      } catch (error) {
        logRuntimeError('executive dashboard route fallback', error);
        console.warn('[ExecutiveDashboardRoute] switched to safe dashboard', error);
        if (!cancelled) {
          setState({
            status: 'safe',
            message: error instanceof Error ? error.message : 'تعذر تحميل لوحة القيادة المتقدمة',
          });
        }
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'ready') {
    const Component = state.Component;
    return <Component />;
  }

  if (state.status === 'safe') {
    return (
      <div className="space-y-4" dir="rtl">
        <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm font-bold text-amber-100">
          تم تشغيل وضع الأمان لأن لوحة القيادة المتقدمة لم تكتمل: {state.message}
        </div>
        <ExecutiveDashboardSafe />
      </div>
    );
  }

  return <DashboardLoadingShell />;
}
