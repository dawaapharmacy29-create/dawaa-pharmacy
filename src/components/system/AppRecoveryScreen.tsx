import { diagnosticsUrl, loginRecoveryUrl, startRecoveryCleanup } from '@/lib/appRecovery';

interface AppRecoveryScreenProps {
  title?: string;
  message?: string;
  reason?: string;
}

export default function AppRecoveryScreen({
  title = 'استعادة تشغيل التطبيق',
  message = 'حدث خطأ أثناء تحميل جزء من التطبيق. ابدأ بالتحديث الآمن أو التشخيص؛ لا تحتاج لإعادة تسجيل الدخول إلا إذا كانت الجلسة نفسها منتهية.',
  reason = 'app',
}: AppRecoveryScreenProps) {
  const loginUrl = typeof window !== 'undefined' ? loginRecoveryUrl(reason) : '/login';
  const cleanLoginUrl = typeof window !== 'undefined' ? loginRecoveryUrl(`${reason}_clean`) : '/login';
  const diagnosticsHref = typeof window !== 'undefined' ? diagnosticsUrl(reason) : '/diagnostics';

  const handleReload = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('_reload', Date.now().toString());
    window.location.replace(url.toString());
  };

  const handleRepair = () => {
    // تنظيف ملفات التشغيل المؤقتة فقط. لا نمسح localStorage/sessionStorage
    // وبالتالي تظل جلسة المستخدم محفوظة لو كانت سليمة.
    startRecoveryCleanup();
    window.setTimeout(handleReload, 450);
  };

  const handleFullClean = () => {
    // هذا هو المسار الوحيد الذي يمسح بيانات التطبيق والجلسة، لذلك يظل خيارًا
    // صريحًا وأخيرًا بدل أن يحدث تلقائيًا عند أي خطأ تحميل عابر.
    startRecoveryCleanup({ clearAppStorage: true });
    window.setTimeout(() => window.location.assign(cleanLoginUrl), 550);
  };

  return (
    <main
      className="min-h-screen bg-slate-950 flex items-center justify-center p-5 text-slate-100"
      dir="rtl"
    >
      <section className="w-full max-w-lg rounded-2xl border border-teal-400/25 bg-slate-900 p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-teal-500/15 text-2xl">
          !
        </div>
        <h1 className="text-2xl font-black text-white">{title}</h1>
        <p className="mt-3 text-sm leading-7 text-slate-300">{message}</p>
        <div className="mt-6 grid gap-3">
          <button
            type="button"
            onClick={handleReload}
            className="rounded-xl bg-teal-600 px-4 py-3 text-sm font-black text-white transition hover:bg-teal-500"
          >
            تحديث آمن
          </button>
          <button
            type="button"
            onClick={handleRepair}
            className="rounded-xl border border-teal-400/40 bg-teal-500/10 px-4 py-3 text-sm font-black text-teal-100 transition hover:bg-teal-500/20"
          >
            إصلاح كاش التشغيل بدون تسجيل خروج
          </button>
          <a
            href={diagnosticsHref}
            className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-200 transition hover:bg-slate-800"
          >
            فتح التشخيص
          </a>
          <a
            href={loginUrl}
            className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-300 transition hover:bg-slate-800"
          >
            الذهاب لتسجيل الدخول فقط
          </a>
          <button
            type="button"
            onClick={handleFullClean}
            className="rounded-xl border border-amber-400/35 bg-amber-500/5 px-4 py-3 text-xs font-black text-amber-100 transition hover:bg-amber-500/15"
          >
            تنظيف كامل وتسجيل خروج — كحل أخير
          </button>
        </div>
      </section>
    </main>
  );
}
