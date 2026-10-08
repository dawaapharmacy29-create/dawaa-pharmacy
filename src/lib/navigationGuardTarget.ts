// Navigation-guard targets. A target may be a function so it is resolved only when the navigation
// actually completes — e.g. after "حفظ ثم الانتقال" created a new current review version.
// A resolved null means "close without a route change".

export type NavigationTarget = string | (() => string | null);

export const NAVIGATION_FALLBACK_PATH = '/operations-center';

export function resolveNavigationTarget(target: NavigationTarget): string | null {
  const value = typeof target === 'function' ? target() : target;
  if (value == null) return null;
  return value.startsWith('/') ? value : NAVIGATION_FALLBACK_PATH;
}
