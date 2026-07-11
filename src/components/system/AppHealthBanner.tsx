import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LAST_RUNTIME_ERROR_KEY } from '@/lib/appRecovery';

const DISMISSED_KEY = 'dawaa_health_banner_dismissed_error';

export default function AppHealthBanner() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const lastError = window.sessionStorage.getItem(LAST_RUNTIME_ERROR_KEY);
      const dismissed = window.sessionStorage.getItem(DISMISSED_KEY);
      if (lastError && dismissed !== lastError) setError(lastError);
    } catch {
      setError(null);
    }
  }, []);

  if (!error) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, error);
    } catch {
      // Ignore storage failures.
    }
    setError(null);
  };

  return (
    <div className="border-b border-amber-300/40 bg-amber-100 px-4 py-2 text-sm text-amber-950" dir="rtl">
      <div className="mx-auto flex max-w-[1720px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link to="/diagnostics" className="font-black underline underline-offset-4">
          يوجد خطأ تشغيل مسجل - افتح التشخيص
        </Link>
        <button type="button" onClick={dismiss} className="text-xs font-black text-amber-900">
          إغلاق
        </button>
      </div>
    </div>
  );
}
