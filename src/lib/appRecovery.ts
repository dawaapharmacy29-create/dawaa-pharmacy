export const RECOVERY_LAST_ERROR_KEY = 'dawaa_last_runtime_error_v1';
export const RECOVERY_BUILD_KEY = 'dawaa_app_build_v1';

export function recordRuntimeError(error: unknown, source = 'runtime') {
  if (typeof window === 'undefined') return;
  try {
    const payload = {
      source,
      message: error instanceof Error ? error.message : String(error || 'unknown error'),
      stack: error instanceof Error ? error.stack : null,
      at: new Date().toISOString(),
      path: window.location.pathname + window.location.search,
      userAgent: window.navigator.userAgent,
    };
    window.sessionStorage.setItem(RECOVERY_LAST_ERROR_KEY, JSON.stringify(payload));
    console.error('[Dawaa Recovery]', payload);
  } catch (e) {
    console.error('[Dawaa Recovery] failed to record error', e, error);
  }
}

export async function clearAppCaches(options: { clearSupabaseAuth?: boolean } = {}) {
  if (typeof window === 'undefined') return;
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch (error) {
    console.warn('[Dawaa Recovery] unregister SW failed', error);
  }

  try {
    if ('caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
  } catch (error) {
    console.warn('[Dawaa Recovery] clear caches failed', error);
  }

  try {
    window.sessionStorage.clear();
  } catch (error) {
    console.warn('[Dawaa Recovery] clear sessionStorage failed', error);
  }

  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      const isSupabaseKey = key.startsWith('sb-') || key.includes('supabase');
      const isSafeToKeep = isSupabaseKey && !options.clearSupabaseAuth;
      if (!isSafeToKeep && (key.startsWith('dawaa_') || key.startsWith('sb-') || key.includes('supabase'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch (error) {
    console.warn('[Dawaa Recovery] clear localStorage failed', error);
  }
}

export async function repairAndReload(options: { login?: boolean; clearSupabaseAuth?: boolean } = {}) {
  await clearAppCaches({ clearSupabaseAuth: options.clearSupabaseAuth });
  const target = options.login ? '/login' : window.location.pathname || '/login';
  const url = new URL(target, window.location.origin);
  url.searchParams.set('_recovery', Date.now().toString());
  window.location.replace(url.toString());
}

export function getLastRuntimeError() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(RECOVERY_LAST_ERROR_KEY);
  } catch {
    return null;
  }
}

export function isRecoverableChunkError(message: string) {
  return /Loading chunk|dynamically imported module|Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|module script|Failed to load module script|MIME type/i.test(message);
}
