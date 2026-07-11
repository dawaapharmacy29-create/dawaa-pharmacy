import './lib/mobileSafariCompat';
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/dawaa-theme.css';
import './styles/dawaa-design-system.css';
import './styles/v3-polish.css';
import './styles/customer-service-followups.css';
import App from './App.tsx';
import SidebarRuntimePolish from '@/components/layout/SidebarRuntimePolish';
import GlobalCustomerServiceAlerts from '@/components/customerService/GlobalCustomerServiceAlerts';
import { AppRecoveryScreen } from '@/components/system/AppRecoveryScreen';
import { isRecoverableChunkError, recordRuntimeError } from '@/lib/appRecovery';
import { installRuntimeSafetyGuards } from '@/lib/runtimeSafety';
import { initOfflineQueueAutoSync } from '@/lib/offlineQueue';
import { initializePerformanceMonitoring } from '@/lib/performanceMonitoring';

type BoundaryState = { hasError: boolean; message?: string };

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
      const marker = 'dawaa_chunk_recovery_v2';
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

function SafeOptionalRuntimeComponents() {
  return (
    <>
      <SidebarRuntimePolish />
      <GlobalCustomerServiceAlerts />
    </>
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
    <RootErrorBoundary>
      <App />
      <SafeOptionalRuntimeComponents />
    </RootErrorBoundary>
  </StrictMode>
);

// Initialize runtime safety, offline queue and performance monitoring. These must never block first paint.
window.setTimeout(() => {
  try {
    installRuntimeSafetyGuards?.();
    initOfflineQueueAutoSync?.();
    initializePerformanceMonitoring();
  } catch (e) {
    recordRuntimeError(e, 'non-fatal-init');
    console.debug('Init failed', e);
  }
}, 0);
