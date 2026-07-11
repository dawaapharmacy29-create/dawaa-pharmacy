import { useEffect } from 'react';

const DETAIL_QUERY_KEYS = ['followupId', 'requestId', 'taskId', 'openDetails', 'mode', 'customerId', 'code', 'phone', 'name', 'customer', 'followup', 'modal'];

function cleanDetailsQuery() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of DETAIL_QUERY_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) {
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', next);
  }
}

export default function CustomerServiceModalSafety() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const hasDetailsModal = /تفاصيل العميل|ملف العميل|العميل الكامل|إجمالي المشتريات|تعديل نتيجة المتابعة/.test(document.body.textContent || '');
      if (!hasDetailsModal) return;
      event.preventDefault();
      event.stopPropagation();
      cleanDetailsQuery();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return null;
}
