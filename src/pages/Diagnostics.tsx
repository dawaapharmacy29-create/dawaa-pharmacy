import { useEffect, useState } from 'react';
import { LAST_RUNTIME_ERROR_KEY, loginRecoveryUrl, removeMatchingStorageKeys } from '@/lib/appRecovery';

type DiagnosticsState = {
  buildId: string;
  url: string;
  origin: string;
  path: string;
  hasSupabaseUrl: boolean;
  hasSupabaseAnonKey: boolean;
  serviceWorkerCount: number;
  serviceWorkerStatus: string;
  cacheNames: string[];
  localStorageKeys: string[];
  sessionStorageKeys: string[];
  lastRuntimeError: string;
  storedUser: string;
};

const BUILD_ID = `build-${new Date().toISOString()}`;
const BUILD_TIME = new Date().toISOString();

function readStorageKeys(storage: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys.sort();
}

function readStoredUserSummary() {
  try {
    const raw = window.localStorage.getItem('dawaa_auth_user_v2');
    if (!raw) return 'لا يوجد مستخدم مخزن';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify({
      id: typeof parsed.id === 'string' ? parsed.id : 'غير محدد',
      name: typeof parsed.name === 'string' ? parsed.name : 'غير محدد',
      username: typeof parsed.username === 'string' ? parsed.username : 'غير محدد',
      role: typeof parsed.role === 'string' ? parsed.role : 'غير محدد',
      branch: typeof parsed.branch === 'string' ? parsed.branch : 'غير محدد',
      active: parsed.active !== false,
    });
  } catch {
    return 'بيانات مستخدم تالفة';
  }
}

async function collectDiagnostics(): Promise<DiagnosticsState> {
  const registrations =
    'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations().catch(() => []) : [];
  const cacheNames = 'caches' in window ? await window.caches.keys().catch(() => []) : [];

  return {
    buildId: import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_BUILD_ID || BUILD_ID,
    url: window.location.href,
    origin: window.location.origin,
    path: `${window.location.pathname}${window.location.search}`,
    hasSupabaseUrl: Boolean(import.meta.env.VITE_SUPABASE_URL),
    hasSupabaseAnonKey: Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY),
    serviceWorkerCount: registrations.length,
    serviceWorkerStatus: registrations.length ? 'يوجد تسجيل service worker' : 'لا يوجد service worker مسجل',
    cacheNames,
    localStorageKeys: readStorageKeys(window.localStorage),
    sessionStorageKeys: readStorageKeys(window.sessionStorage),
    lastRuntimeError: window.sessionStorage.getItem(LAST_RUNTIME_ERROR_KEY) || 'لا يوجد',
    storedUser: readStoredUserSummary(),
  };
}

export default function Diagnostics() {
  const [state, setState] = useState<DiagnosticsState | null>(null);
  const [status, setStatus] = useState('جاهز');

  const refresh = async () => {
    setState(await collectDiagnostics());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const clearCaches = async () => {
    const names = 'caches' in window ? await window.caches.keys() : [];
    await Promise.all(names.map((name) => window.caches.delete(name)));
    console.info('[Dawaa sw] cache names removed', names);
    setStatus(`تم حذف ${names.length} cache`);
    await refresh();
  };

  const unregisterServiceWorkers = async () => {
    const registrations =
      'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    console.info('[Dawaa sw] registrations found/removed', registrations.length);
    setStatus(`تم إلغاء ${registrations.length} service worker`);
    await refresh();
  };

  const clearAppStorage = async () => {
    const localKeys = removeMatchingStorageKeys(window.localStorage);
    const sessionKeys = removeMatchingStorageKeys(window.sessionStorage);
    setStatus(`تم حذف ${localKeys.length + sessionKeys.length} مفتاح تخزين`);
    await refresh();
  };

  const reloadNoCache = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('_nocache', Date.now().toString());
    window.location.replace(url.toString());
  };

  const rows = state
    ? [
        ['Build', state.buildId],
        ['Build time', BUILD_TIME],
        ['URL', state.url],
        ['Origin', state.origin],
        ['Path', state.path],
        ['Supabase URL', state.hasSupabaseUrl ? 'موجود' : 'غير موجود'],
        ['Supabase anon key', state.hasSupabaseAnonKey ? 'موجود' : 'غير موجود'],
        ['Service workers', String(state.serviceWorkerCount)],
        ['Service worker status', state.serviceWorkerStatus],
        ['Cache names', state.cacheNames.join(', ') || 'لا يوجد'],
        ['Stored user', state.storedUser],
        ['localStorage keys', state.localStorageKeys.join(', ') || 'لا يوجد'],
        ['sessionStorage keys', state.sessionStorageKeys.join(', ') || 'لا يوجد'],
        ['Last runtime error', state.lastRuntimeError],
      ]
    : [];

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-slate-100" dir="rtl">
      <section className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-black text-white">تشخيص التطبيق</h1>
            <p className="mt-2 text-sm text-slate-400">هذه الصفحة تعمل بدون تسجيل دخول ولا تعرض القيم السرية.</p>
          </div>
          <div className="text-sm font-bold text-teal-200">{status}</div>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <button className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-black" onClick={clearCaches}>
            clear caches
          </button>
          <button className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-black" onClick={unregisterServiceWorkers}>
            unregister service workers
          </button>
          <button className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-black" onClick={clearAppStorage}>
            clear app storage
          </button>
          <a className="rounded-xl bg-teal-600 px-4 py-3 text-center text-sm font-black" href={loginRecoveryUrl('diagnostics')}>
            go login
          </a>
          <button className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-black" onClick={reloadNoCache}>
            reload no cache
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-2 border-b border-slate-800 p-4 last:border-b-0 md:grid-cols-[220px_1fr]">
              <div className="font-black text-slate-200">{label}</div>
              <div className="break-words text-sm leading-7 text-slate-300">{value}</div>
            </div>
          ))}
          {!state && <div className="p-4 text-slate-300">جاري جمع بيانات التشخيص...</div>}
        </div>
      </section>
    </main>
  );
}
