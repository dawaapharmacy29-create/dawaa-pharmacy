import { useState, useEffect, useCallback } from 'react';
import { isIOSWebKit } from '@/lib/mobileSafariCompat';

interface PWAState {
  isInstallable: boolean;
  isInstalled: boolean;
  isOffline: boolean;
  hasUpdate: boolean;
  swVersion: string | null;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export function usePWA() {
  const [state, setState] = useState<PWAState>({
    isInstallable: false,
    isInstalled: false,
    isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    hasUpdate: false,
    swVersion: null,
  });

  useEffect(() => {
    // ── Register Service Worker ────────────────────────────────────────────
    // iOS Safari is very sensitive to stale service-worker/chunk caches.
    // Keep SW disabled there unless explicitly enabled from Vercel env.
    const enableServiceWorker = import.meta.env.VITE_ENABLE_PWA_SW === 'true' && !isIOSWebKit();
    if (!enableServiceWorker && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          console.info('[Dawaa sw] registrations found/removed', registrations.length);
          return Promise.all(registrations.map((registration) => registration.unregister()));
        })
        .catch((err) => console.warn('[Dawaa sw] unregister failed:', err));
    }

    if (enableServiceWorker && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((reg) => {
          console.log('[PWA] SW registered:', reg.scope);

          // Check for waiting SW (pending update)
          if (reg.waiting) {
            setState((s) => ({ ...s, hasUpdate: true }));
          }

          // Listen for new SW installing
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setState((s) => ({ ...s, hasUpdate: true }));
              }
            });
          });

          // Poll for updates every 30 minutes
          const updateTimer = window.setInterval(() => reg.update(), 30 * 60 * 1000);
          return () => window.clearInterval(updateTimer);
        })
        .catch((err) => console.warn('[PWA] SW registration failed:', err));

      // Listen for SW messages (e.g., SW_UPDATED)
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SW_UPDATED') {
          setState((s) => ({
            ...s,
            swVersion: event.data.version,
            hasUpdate: false, // Update already applied
          }));
        }
      });

      // Detect controller change (new SW took over)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA] New SW controller activated');
        const reloadKey = 'dawaa_sw_reloaded_v18_3';
        try {
          if (!sessionStorage.getItem(reloadKey)) {
            sessionStorage.setItem(reloadKey, '1');
            window.location.reload();
            return;
          }
        } catch {
          window.location.reload();
          return;
        }
        setState((current) => ({ ...current, hasUpdate: false }));
      });
    }

    // ── Online / Offline ───────────────────────────────────────────────────
    const handleOnline = () => setState((s) => ({ ...s, isOffline: false }));
    const handleOffline = () => setState((s) => ({ ...s, isOffline: true }));
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // ── Install Prompt ─────────────────────────────────────────────────────
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      setState((s) => ({ ...s, isInstallable: true }));
    };

    const handleAppInstalled = () => {
      deferredPrompt = null;
      setState((s) => ({ ...s, isInstallable: false, isInstalled: true }));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Detect if already installed (standalone mode)
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as NavigatorWithStandalone).standalone === true
    ) {
      setState((s) => ({ ...s, isInstalled: true }));
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  /** Trigger native install prompt */
  const installApp = useCallback(async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    setState((s) => ({ ...s, isInstallable: false }));
    return outcome === 'accepted';
  }, []);

  /** Tell waiting SW to activate (triggers reload via controllerchange) */
  const applyUpdate = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    setState((s) => ({ ...s, hasUpdate: false }));
  }, []);

  return { ...state, installApp, applyUpdate };
}
