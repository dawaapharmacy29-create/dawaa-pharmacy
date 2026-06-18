import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/dawaa-theme.css';
import './styles/dawaa-design-system.css';
import App from './App.tsx';
import { installRuntimeSafetyGuards } from '@/lib/runtimeSafety';
import { initOfflineQueueAutoSync } from '@/lib/offlineQueue';
import { initializePerformanceMonitoring } from '@/lib/performanceMonitoring';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
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
