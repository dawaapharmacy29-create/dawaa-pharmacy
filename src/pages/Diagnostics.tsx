import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getLastRuntimeError, repairAndReload } from '@/lib/appRecovery';

type DiagnosticsState = {
  origin: string;
  path: string;
  serviceWorkers: string[];
  caches: string[];
  localStorageKeys: string[];
  sessionStorageKeys: string[];
  lastError: string | null;
  userAgent: string;
};

async function collectDiagnostics(): Promise<DiagnosticsState> {
  const serviceWorkers = 'serviceWorker' in navigator
    ? (await navigator.serviceWorker.getRegistrations()).map((reg) => `${reg.scope} — ${reg.active?.state || reg.waiting?.state || 'غير نشط'}`)
    : ['Service Worker غير مدعوم'];
  const caches = 'caches' in window ? await window.caches.keys() : ['Cache API غير مدعوم'];
  const localStorageKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) || '').filter(Boolean).map((key) => {
    if (key.startsWith('sb-') || key.includes('supabase')) return `${key} (auth key)`;
    return key;
  });
  const sessionStorageKeys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index) || '').filter(Boolean);
  return {
    origin: window.location.origin,
    path: window.location.pathname + window.location.search,
    serviceWorkers,
    caches,
    localStorageKeys,
    sessionStorageKeys,
    lastError: getLastRuntimeError(),
    userAgent: navigator.userAgent,
  };
}

export default function Diagnostics() {
  const [state, setState] = useState<DiagnosticsState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setState(await collectDiagnostics());
  useEffect(() => { void refresh(); }, []);

  const repair = async (login = false, clearSupabaseAuth = false) => {
    setBusy(true);
    await repairAndReload({ login, clearSupabaseAuth });
  };

  return (
    <div className="space-y-5 p-4" dir="rtl">
      <section className="rounded-3xl border border-teal-400/20 bg-slate-900 p-5 text-slate-200">
        <h1 className="text-2xl font-black text-white">تشخيص تحميل التطبيق</h1>
        <p className="mt-2 text-sm font-bold text-slate-400">صفحة طوارئ لمراجعة الكاش، Service Worker، وبيئة التشغيل بدون عرض أي أسرار.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm font-black"><RefreshCw size={16} /> تحديث التشخيص</button>
          <button disabled={busy} onClick={() => void repair(false)} className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950"><Trash2 size={16} /> إصلاح التحميل</button>
          <button disabled={busy} onClick={() => void repair(true, true)} className="inline-flex items-center gap-2 rounded-xl border border-rose-400/40 px-4 py-2 text-sm font-black text-rose-100">تسجيل دخول من جديد</button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Supabase" value={isSupabaseConfigured ? 'مضبوط' : 'غير مضبوط'} ok={isSupabaseConfigured} />
        <Card title="Origin" value={state?.origin || '-'} ok />
        <Card title="Service Workers" value={String(state?.serviceWorkers.length || 0)} ok={(state?.serviceWorkers.length || 0) <= 1} />
        <Card title="Caches" value={String(state?.caches.length || 0)} ok={(state?.caches.length || 0) <= 3} />
      </section>

      {state && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Panel title="Service Workers" items={state.serviceWorkers} />
          <Panel title="Caches" items={state.caches} />
          <Panel title="LocalStorage keys" items={state.localStorageKeys} />
          <Panel title="SessionStorage keys" items={state.sessionStorageKeys} />
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 lg:col-span-2">
            <h2 className="mb-3 font-black text-white">آخر خطأ محفوظ</h2>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-xs text-slate-300">{state.lastError || 'لا يوجد خطأ محفوظ'}</pre>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 lg:col-span-2">
            <h2 className="mb-3 font-black text-white">User Agent</h2>
            <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-xs text-slate-300">{state.userAgent}</pre>
          </div>
        </section>
      )}
    </div>
  );
}

function Card({ title, value, ok }: { title: string; value: string; ok: boolean }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4"><div className="flex items-center justify-between"><span className="text-xs font-black text-slate-400">{title}</span>{ok ? <CheckCircle2 className="text-emerald-300" size={18} /> : <AlertCircle className="text-amber-300" size={18} />}</div><div className="mt-2 break-words text-lg font-black text-white">{value}</div></div>;
}

function Panel({ title, items }: { title: string; items: string[] }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4"><h2 className="mb-3 font-black text-white">{title}</h2><div className="space-y-2">{items.length ? items.map((item) => <div key={item} className="rounded-xl bg-slate-950 p-2 text-xs font-bold text-slate-300">{item}</div>) : <div className="text-sm text-slate-500">لا يوجد</div>}</div></div>;
}
