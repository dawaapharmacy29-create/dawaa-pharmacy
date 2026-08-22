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
    // Clear runtime/service-worker caches only. Keep local/session storage so a healthy
    // authenticated session is not destroyed because of a transient chunk failure.
    startRecoveryCleanup();
    window.setTimeout(handleReload, 450);
  };

  const handleFullClean = () => {
    // Full app/session cleanup is deliberately an explicit last-resort action.
    startRecoveryCleanup({ clearAppStorage: true });
    window.setTimeout(() => window.location.assign(cleanLoginUrl), 550);
  };

  return (
    <main className="min-h-screen dawaa-app-bg flex items-center justify-center p-5" dir="rtl">
      <section className="dawaa-card dawaa-surface-raised w-full max-w-lg p-6 text-center">
        <div className="dawaa-status-info mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl text-2xl font-black">
          !
        </div>
        <h1 className="dawaa-title text-2xl">{title}</h1>
        <p className="dawaa-muted mt-3 text-sm leading-7">{message}</p>
        <div className="mt-6 grid gap-3">
          <button type="button" onClick={handleReload} className="dawaa-button dawaa-button-primary w-full">
            تحديث آمن
          </button>
          <button type="button" onClick={handleRepair} className="dawaa-button dawaa-button-secondary w-full">
            إصلاح كاش التشغيل بدون تسجيل خروج
          </button>
          <a href={diagnosticsHref} className="dawaa-button dawaa-button-secondary w-full">
            فتح التشخيص
          </a>
          <a href={loginUrl} className="dawaa-button dawaa-button-secondary w-full">
            الذهاب لتسجيل الدخول فقط
          </a>
          <button type="button" onClick={handleFullClean} className="dawaa-alert dawaa-alert-warning w-full justify-center">
            تنظيف كامل وتسجيل خروج — كحل أخير
          </button>
        </div>
      </section>
    </main>
  );
}