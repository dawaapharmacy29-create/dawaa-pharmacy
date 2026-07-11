import './lib/mobileSafariCompat';
import { StrictMode, Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './styles/dawaa-theme.css';
import './styles/dawaa-design-system.css';
import './styles/v3-polish.css';
import './styles/customer-service-followups.css';
import AppRecoveryScreen from '@/components/system/AppRecoveryScreen';
import { logRuntimeError } from '@/lib/appRecovery';

const APP_IMPORT_TIMEOUT_MS = 8000;

declare global {
  interface Window {
    __DAWAA_REACT_BOOTSTRAPPED?: boolean;
  }
}

function BootstrapShell() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-5" dir="rtl">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="h-12 w-12 rounded-2xl border border-teal-400/30 bg-teal-500/10" />
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-500/20 border-t-teal-400" />
        <p className="text-sm font-bold text-slate-300">جاري التحميل...</p>
      </div>
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function normalizeDefault<T extends ComponentType>(module: { default: T }) {
  return module;
}

async function loadRescueRoute() {
  const path = window.location.pathname;
  if (path === '/login') {
    const module = await import('@/pages/Login');
    const LoginPage = module.default;
    return {
      default: () => (
        <BrowserRouter>
          <LoginPage />
        </BrowserRouter>
      ),
    };
  }
  if (path === '/diagnostics') {
    return await import('@/pages/Diagnostics');
  }
  return null;
}

const SafeApp = lazy(async () => {
  console.info('[Dawaa bootstrap] start');
  try {
    const module = await withTimeout(import('./App.tsx'), APP_IMPORT_TIMEOUT_MS, 'App import');
    console.info('[Dawaa bootstrap] App imported');
    window.__DAWAA_REACT_BOOTSTRAPPED = true;
    return normalizeDefault(module);
  } catch (error) {
    console.error('[Dawaa bootstrap] App import failed', error);
    logRuntimeError('bootstrap App import failed', error);
    const rescueRoute = await loadRescueRoute().catch((rescueError) => {
      logRuntimeError('bootstrap rescue route failed', rescueError);
      return null;
    });
    if (rescueRoute) return rescueRoute;
    return {
      default: () => (
        <AppRecoveryScreen
          reason="app_import_failed"
          title="تعذر تحميل التطبيق"
          message="فشل تحميل ملفات التطبيق الأساسية. افتح تسجيل الدخول أو التشخيص، ويمكن تشغيل التنظيف في الخلفية بدون انتظار."
        />
      ),
    };
  }
});

function isOptionalRuntimeEnabled() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('addons') === '1' || params.get('runtime') === '1' || params.get('debug') === '1';
}

function OptionalRuntimeAddons() {
  const [mounted, setMounted] = useState(false);
  const enabled = isOptionalRuntimeEnabled();

  useEffect(() => {
    if (!enabled) return;
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, [enabled]);

  if (!enabled || !mounted) return null;

  const SidebarRuntimePolish = lazy(async () => {
    try {
      return await import('@/components/layout/SidebarRuntimePolish');
    } catch (error) {
      logRuntimeError('SidebarRuntimePolish import failed', error);
      return { default: () => null };
    }
  });

  const GlobalCustomerServiceAlerts = lazy(async () => {
    try {
      return await import('@/components/customerService/GlobalCustomerServiceAlerts');
    } catch (error) {
      logRuntimeError('GlobalCustomerServiceAlerts import failed', error);
      return { default: () => null };
    }
  });

  return (
    <Suspense fallback={null}>
      <SidebarRuntimePolish />
      <GlobalCustomerServiceAlerts />
    </Suspense>
  );
}

function initOptionalRuntimeServices() {
  if (!isOptionalRuntimeEnabled()) return;

  void import('@/lib/runtimeSafety')
    .then(({ installRuntimeSafetyGuards }) => installRuntimeSafetyGuards?.())
    .catch((error) => logRuntimeError('runtimeSafety init failed', error));

  void import('@/lib/offlineQueue')
    .then(({ initOfflineQueueAutoSync }) => initOfflineQueueAutoSync?.())
    .catch((error) => logRuntimeError('offlineQueue init failed', error));

  void import('@/lib/performanceMonitoring')
    .then(({ initializePerformanceMonitoring }) => initializePerformanceMonitoring?.())
    .catch((error) => logRuntimeError('performanceMonitoring init failed', error));
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  logRuntimeError('bootstrap root missing', new Error('Missing #root element'));
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <Suspense fallback={<BootstrapShell />}>
        <SafeApp />
        <OptionalRuntimeAddons />
      </Suspense>
    </StrictMode>
  );
  window.requestAnimationFrame(() => initOptionalRuntimeServices());
}
