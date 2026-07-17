import { useLayoutEffect } from 'react';
import ExecutiveDashboard2027 from '@/pages/ExecutiveDashboard2027';

const LEGACY_DASHBOARD_TIMEOUT_MS = 7000;
const RESILIENT_DASHBOARD_TIMEOUT_MS = 45000;

/**
 * The advanced dashboard historically schedules all of its section guards and
 * doctor-competition request guard with a 7 second timeout. The underlying
 * Supabase reads are paginated and can legitimately take longer on a cold
 * connection, especially after a large invoice import.
 *
 * This wrapper expands only the legacy 7 second dashboard timers while the
 * dashboard is mounted. Other application pages keep their existing timeout
 * behavior. It does not alter requests, calculations, permissions, or data.
 */
export default function ExecutiveDashboard2027Resilient() {
  useLayoutEffect(() => {
    const originalSetTimeout = window.setTimeout.bind(window);

    const resilientSetTimeout: typeof window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const effectiveTimeout =
        timeout === LEGACY_DASHBOARD_TIMEOUT_MS
          ? RESILIENT_DASHBOARD_TIMEOUT_MS
          : timeout;
      return originalSetTimeout(handler, effectiveTimeout, ...args);
    }) as typeof window.setTimeout;

    window.setTimeout = resilientSetTimeout;

    return () => {
      window.setTimeout = originalSetTimeout;
    };
  }, []);

  return <ExecutiveDashboard2027 />;
}
