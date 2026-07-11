import './lib/mobileSafariCompat';
import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/dawaa-theme.css';
import './styles/dawaa-design-system.css';
import './styles/v3-polish.css';
import './styles/customer-service-followups.css';
import { AppRecoveryScreen } from '@/components/system/AppRecoveryScreen';
import { isRecoverableChunkError, recordRuntimeError } from '@/lib/appRecovery';

type BoundaryState = { hasError: boolean; message?: string };
type BootState =
  | { status: 'loading' }
  | { status: 'ready'; App: React.ComponentType; SidebarRuntimePolish?: React.ComponentType; GlobalCustomerServiceAlerts?: React.ComponentType }
  | { status: 'failed'; message: string };

class RootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'unknown error' };
  }

  componentDidCatch(error: Error, info: unknown) {
    recordRuntimeError(error, 'root-boundary');
    console.error('[Dawaa bootstrap] Root error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return <AppRecoveryScreen technicalError={this.state.message} />;
    }
    return this.props.children;
  }
}

function installStartupRecoveryHandlers() {
  if (typeof window === 'undefined') return;
  console.info('[Dawaa bootstrap] starting app', { path: window.location.pathname, at: new Date().toISOString() });

  const recover = (reason: unknown) => {
    recordRuntimeError(reason, 'startup-handler');
    const message = reason instanceof Error ? reason.message : String(reason || '');
    if (!isRecoverableChunkError(message)) return;
    try {
      const marker = 'dawaa_chunk_recovery_v3';
      if (window.sessionStorage.getItem(marker)) return;
      window.sessionStorage.setItem(marker, '1');
    } catch {
      // continue with reload even if storage is blocked
    }
    const url = new URL(window.location.href);
    url.searchParams.set('_chunk_recovery', Date.now().toString());
    window.location.replace(url.toString());
  };

  window.addEventListener('error', (event) => {
    const message = `${event.message || ''} ${(event.error as Error | undefined)?.message || ''}`;
    if (message.trim()) recover(event.error || message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    recover(event.reason);
  });
}

function LongLoadingFallback() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  if (slow) {
    return <AppRecoveryScreen technicalError="استغرق تحميل ملف التطبيق الرئيسي وقتًا أطول من المعتاد." />;
  }

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center" dir="rtl">
      <div className="flex flex-col items-center gap-4 text-slate-300">
        <div className="w-8 h-8 border-3 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
        <div className="text-sm">جاري التحميل...</div>
      </div>
    </div>
  );
}

function BootstrapApp() {
  const [state, setState] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    async function boot() {
      try {
        console.info('[Dawaa bootstrap] loading app modules');
        const appModule = await import('./App.tsx');
        let sidebarModule: { default?: React.ComponentType } | null = null;
        let alertsModule: { default?: React.ComponentType } | null = null;

        try {
          sidebarModule = await import('@/components/layout/SidebarRuntimePolish');
        } catch (error) {
          recordRuntimeError(error, 'optional-sidebar-runtime-polish');
          console.warn('[Dawaa bootstrap] optional SidebarRuntimePolish skipped', error);
        }

        try {
          alertsModule = await import('@/components/customerService/GlobalCustomerServiceAlerts');
        } catch (error) {
          recordRuntimeError(error, 'optional-customer-service-alerts');
          console.warn('[Dawaa bootstrap] optional GlobalCustomerServiceAlerts skipped', error);
        }

        setTimeout(async () => {
          try {
            const [{ installRuntimeSafetyGuards }, { initOfflineQueueAutoSync }, { initializePerformanceMonitoring }] = await Promise.all([
              import('@/lib/runtimeSafety'),
              import('@/lib/offlineQueue'),
              import('@/lib/performanceMonitoring'),
            ]);
            installRuntimeSafetyGuards?.();
            initOfflineQueueAutoSync?.();
            initializePerformanceMonitoring?.();
          } catch (error) {
            recordRuntimeError(error, 'non-fatal-init');
            console.debug('[Dawaa bootstrap] non-fatal init skipped', error);
          }
        }, 0);

        if (!alive) return;
        setState({
          status: 'ready',
          App: appModule.default,
          SidebarRuntimePolish: sidebarModule?.default,
          GlobalCustomerServiceAlerts: alertsModule?.default,
        });
      } catch (error) {
        recordRuntimeError(error, 'bootstrap-dynamic-import');
        console.error('[Dawaa bootstrap] failed to import app', error);
        if (!alive) return;
        setState({ status: 'failed', message: error instanceof Error ? error.message : String(error || 'unknown bootstrap error') });
      }
    }
    void boot();
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === 'failed') return <AppRecoveryScreen technicalError={state.message} />;
  if (state.status === 'loading') return <LongLoadingFallback />;

  const App = state.App;
  const SidebarRuntimePolish = state.SidebarRuntimePolish;
  const GlobalCustomerServiceAlerts = state.GlobalCustomerServiceAlerts;

  return (
    <RootErrorBoundary>
      <App />
      {SidebarRuntimePolish ? <SidebarRuntimePolish /> : null}
      {GlobalCustomerServiceAlerts ? <GlobalCustomerServiceAlerts /> : null}
    </RootErrorBoundary>
  );
}

installStartupRecoveryHandlers();

const rootElement = document.getElementById('root');
if (!rootElement) {
  document.body.innerHTML = '<div style="direction:rtl;color:white;background:#020617;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif">تعذر بدء التطبيق: عنصر root غير موجود</div>';
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <BootstrapApp />
  </StrictMode>
);
