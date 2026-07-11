import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import ExecutiveDashboardSafe from '@/pages/ExecutiveDashboardSafe';
import { logRuntimeError } from '@/lib/appRecovery';

const DASHBOARD_IMPORT_TIMEOUT_MS = 8000;

type DashboardState =
  | { status: 'safe'; message: string }
  | { status: 'loading-advanced'; Component?: undefined; message?: undefined }
  | { status: 'ready-advanced'; Component: ComponentType; message?: undefined };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function AdvancedLoadingShell() {
  return (
    <main className="space-y-6 text-slate-100" dir="rtl">
      <section className="rounded-2xl border border-teal-400/20 bg-slate-900 p-6">
        <div className="h-8 w-64 animate-pulse rounded-xl bg-slate-700/70" />
        <div className="mt-4 h-4 w-96 max-w-full animate-pulse rounded-xl bg-slate-800" />
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm font-bold text-slate-300">
        جاري تحميل النسخة المتقدمة... إذا تأخر التحميل يتم الانتقال إلى النسخة الآمنة تلقائيًا.
      </section>
    </main>
  );
}

function dashboardMode() {
  if (typeof window === 'undefined') return 'advanced';
  const params = new URLSearchParams(window.location.search);
  if (params.get('safe') === '1') return 'safe';
  if (params.get('advanced') === '1' || params.get('legacy') === '1' || params.get('dashboard') === 'advanced') {
    return 'advanced';
  }
  return 'advanced';
}

class DashboardRuntimeErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    logRuntimeError('executive dashboard advanced render failed', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="space-y-4" dir="rtl">
          <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm font-bold leading-7 text-amber-100">
            تعذر عرض النسخة المتقدمة بشكل صحيح. تم تشغيل النسخة الآمنة بدلاً منها.
          </div>
          <ExecutiveDashboardSafe />
        </div>
      );
    }

    return this.props.children;
  }
}

export default function ExecutiveDashboardRoute() {
  const [state, setState] = useState<DashboardState>(() => {
    const mode = dashboardMode();
    if (mode === 'safe') {
      return {
        status: 'safe',
        message: 'تم تشغيل النسخة الآمنة فقط لأنك طلبت ?safe=1.',
      };
    }
    return { status: 'loading-advanced' };
  });

  useEffect(() => {
    if (state.status !== 'loading-advanced') return;
    let cancelled = false;

    async function loadAdvancedDashboard() {
      try {
        const module = await withTimeout(
          import('@/pages/ExecutiveDashboard2027'),
          DASHBOARD_IMPORT_TIMEOUT_MS,
          'ExecutiveDashboard2027 import'
        );
        if (!cancelled) setState({ status: 'ready-advanced', Component: module.default });
      } catch (error) {
        logRuntimeError('executive dashboard advanced fallback', error);
        console.warn('[ExecutiveDashboardRoute] switched to safe dashboard', error);
        if (!cancelled) {
          setState({
            status: 'safe',
            message: error instanceof Error ? error.message : 'تعذر تحميل لوحة القيادة المتقدمة',
          });
        }
      }
    }

    void loadAdvancedDashboard();
    return () => {
      cancelled = true;
    };
  }, [state.status]);

  if (state.status === 'ready-advanced') {
    const Component = state.Component;
    return (
      <DashboardRuntimeErrorBoundary>
        <Component />
      </DashboardRuntimeErrorBoundary>
    );
  }

  if (state.status === 'loading-advanced') return <AdvancedLoadingShell />;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm font-bold leading-7 text-amber-100">
        {state.message}
      </div>
      <ExecutiveDashboardSafe />
    </div>
  );
}
