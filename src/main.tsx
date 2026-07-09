import './lib/mobileSafariCompat';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/dawaa-theme.css';
import './styles/dawaa-design-system.css';
import './styles/v3-polish.css';
import './styles/customer-service-followups.css';
import App from './App.tsx';
import ExecutiveCustomerServiceKpiSync from '@/components/dashboard/ExecutiveCustomerServiceKpiSync';
import GlobalCustomerServiceAlerts from '@/components/customerService/GlobalCustomerServiceAlerts';
import { installRuntimeSafetyGuards } from '@/lib/runtimeSafety';
import { initOfflineQueueAutoSync } from '@/lib/offlineQueue';
import { initializePerformanceMonitoring } from '@/lib/performanceMonitoring';

function installStartupRecoveryHandlers() {
  if (typeof window === 'undefined') return;
  const isRecoverable = (message: string) =>
    /Loading chunk|dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|module script/i.test(message);

  const recover = () => {
    try {
      const marker = 'dawaa_chunk_recovery_v1';
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
    if (isRecoverable(message)) recover();
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason || '');
    if (isRecoverable(message)) recover();
  });
}

installStartupRecoveryHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ExecutiveCustomerServiceKpiSync />
    <GlobalCustomerServiceAlerts />
  </StrictMode>
);

// Initialize runtime safety, offline queue and performance monitoring
try {
  installRuntimeSafetyGuards?.();
  initOfflineQueueAutoSync?.();
  initializePerformanceMonitoring();
} catch (e) {
  // Non-fatal: log to console for now
  console.debug('Init failed', e);
}
