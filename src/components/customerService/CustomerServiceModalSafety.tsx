import { useEffect } from 'react';

const DETAIL_QUERY_KEYS = [
  'followupId',
  'openDetails',
  'mode',
  'customerId',
  'code',
  'phone',
  'name',
];

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

function isCustomerDetailsCloseButton(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const button = target.closest('button');
  if (!button) return false;
  const label = (button.textContent || '').replace(/\s+/g, ' ').trim();
  if (!/إغلاق|اغلاق|×|Close/i.test(label)) return false;
  const modal = button.closest('[role="dialog"], .fixed, .modal, .customer-details-modal');
  const modalText = modal?.textContent || document.body.textContent || '';
  return /تفاصيل العميل|ملف العميل|العميل الكامل|إجمالي المشتريات|تعديل نتيجة المتابعة/.test(modalText);
}

function clickVisibleDetailsCloseButton() {
  const buttons = Array.from(document.querySelectorAll('button'));
  const closeButton = buttons.find((button) => {
    const label = (button.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/إغلاق|اغلاق|×|Close/i.test(label)) return false;
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const modal = button.closest('[role="dialog"], .fixed, .modal, .customer-details-modal');
    const modalText = modal?.textContent || '';
    return /تفاصيل العميل|ملف العميل|العميل الكامل|إجمالي المشتريات|تعديل نتيجة المتابعة/.test(modalText);
  });
  closeButton?.click();
}

export default function CustomerServiceModalSafety() {
  useEffect(() => {
    const onPointerDownCapture = (event: PointerEvent) => {
      if (isCustomerDetailsCloseButton(event.target)) cleanDetailsQuery();
    };

    const onClickCapture = (event: MouseEvent) => {
      if (isCustomerDetailsCloseButton(event.target)) cleanDetailsQuery();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const hasDetailsModal = /تفاصيل العميل|ملف العميل|العميل الكامل|إجمالي المشتريات|تعديل نتيجة المتابعة/.test(document.body.textContent || '');
      if (!hasDetailsModal) return;
      event.preventDefault();
      event.stopPropagation();
      cleanDetailsQuery();
      window.setTimeout(clickVisibleDetailsCloseButton, 0);
    };

    window.addEventListener('pointerdown', onPointerDownCapture, true);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDownCapture, true);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  return null;
}
