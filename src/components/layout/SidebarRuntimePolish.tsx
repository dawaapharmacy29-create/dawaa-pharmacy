import { useEffect } from 'react';

const NAV_SCROLL_KEY = 'dawaa_sidebar_nav_scroll_top_v2';

function normalizeText(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function polishSidebar() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  // Hide duplicate dashboard entry: keep /executive-2027 as the single visible leadership dashboard.
  const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const label = normalizeText(link.textContent);
    if ((href === '/' || href.endsWith('/')) && label.includes('لوحة القيادة 2027')) {
      const wrapper = link.closest('div.space-y-1') as HTMLElement | null;
      (wrapper || link).style.display = 'none';
    }
    if (href.includes('/executive-2027') && /الداشبورد التنفيذي|لوحة القيادة 2027/.test(label)) {
      const textSpan = Array.from(link.querySelectorAll('span')).find((span) => normalizeText(span.textContent).length > 0);
      if (textSpan) textSpan.textContent = 'لوحة القيادة 2027';
      link.setAttribute('aria-label', 'لوحة القيادة 2027');
    }
  }
}

export default function SidebarRuntimePolish() {
  useEffect(() => {
    let restored = false;
    const restoreScroll = () => {
      const nav = document.getElementById('sidebar-nav');
      if (!nav || restored) return;
      restored = true;
      const saved = Number(window.sessionStorage.getItem(NAV_SCROLL_KEY) || 0);
      if (Number.isFinite(saved) && saved > 0) nav.scrollTop = saved;
      nav.addEventListener('scroll', () => {
        window.sessionStorage.setItem(NAV_SCROLL_KEY, String(nav.scrollTop));
      }, { passive: true });
    };

    const run = () => {
      polishSidebar();
      restoreScroll();
    };

    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', run);
    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', run);
    };
  }, []);

  return null;
}
