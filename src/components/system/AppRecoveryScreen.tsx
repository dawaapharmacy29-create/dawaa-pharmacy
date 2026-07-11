import { useEffect, useState } from 'react';
import { AlertTriangle, Home, LogIn, RefreshCw, Trash2 } from 'lucide-react';
import { forceGoLogin, getLastRuntimeError, repairAndReload } from '@/lib/appRecovery';

export function AppRecoveryScreen({
  title = 'حدث خطأ أثناء تحميل التطبيق',
  message = 'لن نترك الشاشة سوداء. استخدم أزرار الإصلاح بالأسفل لإعادة تشغيل التطبيق بأمان.',
  technicalError,
}: {
  title?: string;
  message?: string;
  technicalError?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [storedError, setStoredError] = useState<string | null>(null);

  useEffect(() => {
    setStoredError(getLastRuntimeError());
  }, []);

  const repair = async (login = true, clearSupabaseAuth = false) => {
    setBusy(true);
    await repairAndReload({ login, clearSupabaseAuth });
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#123042_0%,#0b1722_45%,#020617_100%)] flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-xl rounded-3xl border border-amber-400/20 bg-slate-900/95 p-6 text-center text-slate-200 shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-300/30 bg-amber-300/10 text-amber-200">
          <AlertTriangle size={34} />
        </div>
        <h1 className="text-2xl font-black text-white">{title}</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-300">{message}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button disabled={busy} onClick={() => window.location.reload()} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-600 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">
            <RefreshCw size={16} /> إعادة المحاولة
          </button>
          <button disabled={busy} onClick={() => void repair(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-teal-500 px-4 py-3 text-sm font-black text-slate-950 hover:bg-teal-400 disabled:opacity-60">
            <Trash2 size={16} /> إصلاح التحميل
          </button>
          <a href={`/login?_direct=${Date.now()}`} onClick={(event) => { event.preventDefault(); forceGoLogin(); }} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-400/40 px-4 py-3 text-sm font-black text-teal-100 hover:bg-teal-400/10">
            <LogIn size={16} /> فتح تسجيل الدخول فورًا
          </a>
          <button disabled={busy} onClick={() => void repair(true, true)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-400/40 px-4 py-3 text-sm font-black text-rose-100 hover:bg-rose-400/10 disabled:opacity-60">
            <Home size={16} /> دخول من جديد
          </button>
        </div>
        <p className="mt-4 text-xs font-bold text-slate-500">لو زر الإصلاح لم يستجب، استخدم زر فتح تسجيل الدخول فورًا لأنه رابط مباشر وليس عملية تنظيف.</p>
        {(technicalError || storedError) && (
          <details className="mt-5 rounded-2xl border border-slate-700 bg-slate-950 p-3 text-right text-xs text-slate-400">
            <summary className="cursor-pointer font-black text-slate-200">تفاصيل تقنية للمراجعة</summary>
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words">{technicalError || storedError}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

export function SlowLoadingRecovery({ delayMs = 8000 }: { delayMs?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!slow) {
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center" dir="rtl">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-3 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
          <div className="text-slate-400 text-sm">جاري التحميل...</div>
        </div>
      </div>
    );
  }

  return (
    <AppRecoveryScreen
      title="التطبيق يستغرق وقتًا أطول من المعتاد"
      message="قد تكون هناك نسخة كاش قديمة أو ملف تحميل لم يصل. اضغط إصلاح التحميل ثم جرّب تسجيل الدخول مرة أخرى."
    />
  );
}
