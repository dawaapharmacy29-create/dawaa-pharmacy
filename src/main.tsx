import './lib/mobileSafariCompat';
import { StrictMode, Suspense, lazy, useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/dawaa-design-system.css';
import './styles/v3-polish.css';
import './styles/customer-service-followups.css';
import './styles/customer-cashback-polish.css';
import './styles/reviews-modal-polish.css';
import './styles/doctor-dashboard-hero.css';
import './styles/customer-requests-polish.css';
/* Legacy compatibility bridge. New UI must not add selectors here. */
import './styles/dawaa-theme.css';
/* Canonical theme system: tokens -> foundation semantics -> palettes -> components -> app shell. */
import './styles/dawaa-theme-tokens.css';
import './styles/dawaa-theme-foundation.css';
import './styles/dawaa-theme-palettes.css';
import './styles/dawaa-theme-components.css';
import './styles/dawaa-theme-shell.css';
import App from './App.tsx';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { clearRecoveredRuntimeError, clearStaleChunkRecoveryMarker, logRuntimeError } from '@/lib/appRecovery';

const BOOTSTRAP_RECOVERY_SCOPE = 'bootstrap';

declare global {
  interface Window {
    __DAWAA_REACT_BOOTSTRAPPED?: boolean;
    __DAWAA_MARK_REACT_BOOTSTRAPPED?: () => void;
  }
}

function ReactBootstrapMarker() {
  useLayoutEffect(() => {
    window.__DAWAA_MARK_REACT_BOOTSTRAPPED?.();
    clearRecoveredRuntimeError();
    clearStaleChunkRecoveryMarker(BOOTSTRAP_RECOVERY_SCOPE);
  }, []);
  return null;
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
        <ReactBootstrapMarker />
        <Suspense fallback={<BootstrapShell />}>
          <App />
          <OptionalRuntimeAddons />
        </Suspense>
      </ThemeProvider>
    </StrictMode>
  );
  window.requestAnimationFrame(() => initOptionalRuntimeServices());
}
