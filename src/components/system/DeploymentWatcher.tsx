import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // كل 5 دقايق
const MAIN_SCRIPT_PATTERN = /<script[^>]*type="module"[^>]*src="([^"]+)"/i;

function extractMainScriptSrc(html: string): string | null {
  const match = html.match(MAIN_SCRIPT_PATTERN);
  return match ? match[1] : null;
}

async function fetchLiveMainScriptSrc(): Promise<string | null> {
  try {
    const response = await fetch('/', { cache: 'no-store' });
    if (!response.ok) return null;
    const html = await response.text();
    return extractMainScriptSrc(html);
  } catch {
    return null;
  }
}

function reloadSilently() {
  const url = new URL(window.location.href);
  url.searchParams.set('_r', Date.now().toString());
  window.location.replace(url.toString());
}

/**
 * بعد أي نشرة جديدة، أي تاب فاتح من قبل بيفضل شاير على ملفات JS قديمة اتشالت
 * فعليًا من آخر نشرة — وده اللي بيسبب "تعذر تحميل هذه الصفحة" لحظة ما حد
 * يحاول يفتح صفحة جديدة (مثال: /login). بدل ما ننتظر الخطأ يحصل ونتعافى منه،
 * الكومبوننت ده بيتابع في الخلفية هل فيه نشرة جديدة، ولو لقى فرق:
 *  - والتاب مقفول/في تاب تاني (hidden) → تحديث صامت فورًا، محدش هيحس.
 *  - والتاب مفتوح وشغال بيه → تنبيه بسيط غير مزعج بدل ما نقاطع شغله فجأة.
 */
export default function DeploymentWatcher() {
  const baselineRef = useRef<string | null>(null);
  const notifiedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void fetchLiveMainScriptSrc().then((src) => {
      if (!cancelled && src) baselineRef.current = src;
    });

    async function checkForUpdate() {
      if (notifiedRef.current) return;
      const current = await fetchLiveMainScriptSrc();
      if (!current || !baselineRef.current) return;
      if (current === baselineRef.current) return;

      if (document.visibilityState === 'hidden') {
        reloadSilently();
        return;
      }

      notifiedRef.current = true;
      toast.info('في نسخة جديدة من التطبيق جاهزة 🌿', {
        description: 'التحديث سريع ومش هيأثر على أي بيانات مسجلة.',
        duration: 60000,
        action: {
          label: 'تحديث الآن',
          onClick: reloadSilently,
        },
      });
    }

    const interval = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
