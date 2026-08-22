import { diagnosticsUrl, loginRecoveryUrl, redirectToLoginWithRecovery, startRecoveryCleanup } from '@/lib/appRecovery';

interface AppRecoveryScreenProps {
  title?: string;
  message?: string;
  reason?: string;
}

export default function AppRecoveryScreen({
  title = 'إصلاح تحميل التطبيق',
  message = 'تعذر إكمال تحميل التطبيق. يمكنك فتح تسجيل الدخول فورًا أو تنظيف ملفات التشغيل المؤقتة ثم الدخول من جديد.',
  reason = 'app',
}: AppRecoveryScreenProps) {
  const loginUrl = typeof window !== 'undefined' ? loginRecoveryUrl(reason) : '/login';
  const cleanLoginUrl = typeof window !== 'undefined' ? loginRecoveryUrl(`${reason}_clean`) : '/login';
  const diagnosticsHref = typeof window !== 'undefined' ? diagnosticsUrl(reason) : '/diagnostics';

  const handleRepair = () => {
    redirectToLoginWithRecovery(reason, true);
  };

  const handleFullClean = () => {
    redirectToLoginWithRecovery(`${reason}_clean`, true);
  };

  const handleReload = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('_reload', Date.now().toString());
    window.location.replace(url.toString());
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
          <button type="button" onClick={handleReload} className="dawaa-button dawaa-button-secondary w-full">
            تحديث
          </button>
          <a
            href={loginUrl}
            onClick={() => startRecoveryCleanup()}
            className="dawaa-button dawaa-button-primary w-full"
          >
            فتح تسجيل الدخول فقط
          </a>
          <a href={cleanLoginUrl} onClick={handleRepair} className="dawaa-button dawaa-button-secondary w-full">
            إصلاح التحميل
          </a>
          <a href={cleanLoginUrl} onClick={handleFullClean} className="dawaa-alert dawaa-alert-warning w-full justify-center">
            تنظيف كامل والدخول من جديد
          </a>
          <a href={diagnosticsHref} className="dawaa-button dawaa-button-secondary w-full">
            فتح التشخيص
          </a>
        </div>
      </section>
    </main>
  );
}
