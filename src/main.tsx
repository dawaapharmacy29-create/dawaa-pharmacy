import './lib/mobileSafariCompat';
import { StrictMode, Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './styles/dawaa-design-system.css';
import './styles/v3-polish.css';
import './styles/customer-service-followups.css';
import './styles/customer-cashback-polish.css';
import './styles/reviews-modal-polish.css';
/* Legacy compatibility bridge. New UI must not add selectors here. */
import './styles/dawaa-theme.css';
/* Canonical theme system: tokens -> foundation semantics -> palettes -> components -> app shell. */
import './styles/dawaa-theme-tokens.css';
import './styles/dawaa-theme-foundation.css';
import './styles/dawaa-theme-palettes.css';
import './styles/dawaa-theme-components.css';
import './styles/dawaa-theme-shell.css';
import AppRecoveryScreen from '@/components/system/AppRecoveryScreen';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { clearRecoveredRuntimeError, logRuntimeError } from '@/lib/appRecovery';

const APP_IMPORT_TIMEOUT_MS = 25000;

declare global {
  interface Window {
    __DAWAA_REACT_BOOTSTRAPPED?: boolean;
  }
}

function BootstrapShell() {
  return (
    <div className="min-h-screen dawaa-app-bg flex items-center justify-center p-5" dir="rtl">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="dawaa-loading-mark" />
        <div className="dawaa-loading-spinner" />
        <p className="text-sm font-bold dawaa-muted">جاري التحميل...</p>
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

function isStaleChunkImportError(error: unknown) {
  const message = String((error as Error)?.message || '');
  return /Failed to fetch dynamically imported module|Loading chunk|dynamically imported module|error loading dynamically imported module/i.test(message);
}

const SafeApp = lazy(async () => {
  console.info('[Dawaa bootstrap] start');
  try {
    const module = await withTimeout(import('./App.tsx'), APP_IMPORT_TIMEOUT_MS, 'App import');
    console.info('[Dawaa bootstrap] App imported');
    window.__DAWAA_REACT_BOOTSTRAPPED = true;
    clearRecoveredRuntimeError();
    try { sessionStorage.removeItem('dawaa_stale_chunk_reload_at'); } catch { /* ignore storage failures */ }
    return normalizeDefault(module);
  } catch (error) {
    console.error('[Dawaa bootstrap] App import failed', error);
    logRuntimeError('bootstrap App import failed', error);
    if (isStaleChunkImportError(error)) {
      const key = 'dawaa_stale_chunk_reload_at';
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last > 15000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.href = window.location.pathname + window.location.search
          + (window.location.search ? '&' : '?') + '_r=' + Date.now() + window.location.hash;
        return { default: BootstrapShell };
      }
    }
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
      <ThemeProvider>
        <Suspense fallback={<BootstrapShell />}>
          <SafeApp />
          <OptionalRuntimeAddons />
        </Suspense>
      </ThemeProvider>
    </StrictMode>
  );
  window.requestAnimationFrame(() => initOptionalRuntimeServices());
}
