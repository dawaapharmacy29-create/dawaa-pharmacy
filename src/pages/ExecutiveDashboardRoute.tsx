import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import ExecutiveDashboardSafe from '@/pages/ExecutiveDashboardSafe';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import {
  clearStaleChunkRecoveryMarker,
  isStaleChunkImportError,
  logRuntimeError,
  recoverFromStaleChunkOnce,
} from '@/lib/appRecovery';

const DASHBOARD_IMPORT_TIMEOUT_MS = 15000;
const DASHBOARD_RECOVERY_SCOPE = 'executive-dashboard';

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
    <main className="dawaa-page space-y-4" dir="rtl">
      <section className="dawaa-card dawaa-card--soft p-6">
        <div className="h-8 w-64 animate-pulse rounded-xl bg-[var(--dawaa-theme-soft)]" />
        <div className="mt-4 h-4 w-96 max-w-full animate-pulse rounded-xl bg-[var(--dawaa-theme-soft)]" />
      </section>
      <section className="dawaa-card p-5 text-sm font-bold dawaa-body">
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

function SafeModeNotice({ children }: { children: ReactNode }) {
  return (
    <div className="dawaa-alert dawaa-alert--warning text-sm font-bold leading-7">
      {children}
    </div>
  );
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
          <SafeModeNotice>
            تعذر عرض النسخة المتقدمة بشكل صحيح. تم تشغيل النسخة الآمنة بدلاً منها.
          </SafeModeNotice>
          <ExecutiveDashboardSafe />
        </div>
      );
    }

    return this.props.children;
  }
}

export default function ExecutiveDashboardRoute() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
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

  // Assistants have their own operational workspace. Redirect before loading the
  // executive dashboard so they never fall through legacy doctor/time-off routes.
  if (role === 'assistant') {
    return <Navigate to="/assistant-operational-log" replace />;
  }

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
        clearStaleChunkRecoveryMarker(DASHBOARD_RECOVERY_SCOPE);
        if (!cancelled) setState({ status: 'ready-advanced', Component: module.default });
      } catch (error) {
        logRuntimeError('executive dashboard advanced fallback', error);
        console.warn('[ExecutiveDashboardRoute] advanced dashboard import failed', error);

        if (isStaleChunkImportError(error)) {
          const recovering = await recoverFromStaleChunkOnce(DASHBOARD_RECOVERY_SCOPE);
          if (recovering) return;
        }

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
        <div data-theme-runtime="executive-2027">
          <Component />
        </div>
      </DashboardRuntimeErrorBoundary>
    );
  }

  if (state.status === 'loading-advanced') return <AdvancedLoadingShell />;

  return (
    <div className="space-y-4" dir="rtl">
      <SafeModeNotice>{state.message}</SafeModeNotice>
      <ExecutiveDashboardSafe />
    </div>
  );
}
