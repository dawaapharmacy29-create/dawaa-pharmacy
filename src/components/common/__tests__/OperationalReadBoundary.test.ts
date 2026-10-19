import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OperationalReadBoundary from '../OperationalReadBoundary';

describe('operational read availability', () => {
  const content = createElement('button', null, 'تنفيذ طلب');
  const render = (loading: boolean, error: string | null = null, children: ReactNode = content) =>
    renderToStaticMarkup(createElement(OperationalReadBoundary, { loading, error, label: 'الطلبات' }, children));
  it('does not expose initial zero or an empty list while pending', () => {
    const html = render(true, null, createElement('p', null, '0 طلب — لا توجد نتائج'));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('جارٍ تحميل');
    expect(html).not.toContain('0 طلب');
    expect(html).not.toContain('لا توجد نتائج');
  });
  it('does not mount operational actions during initial load or refresh', () => {
    expect(render(true)).not.toContain('<button');
  });
  it('does not expose stale actions or a valid-looking empty result after failure', () => {
    const html = render(false, 'network unavailable');
    expect(html).toContain('غير متاحة حاليًا');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('network unavailable');
  });
  it('does not mount child readers when data is unavailable', () => {
    const Child = () => { throw new Error('must not render'); };
    expect(() => render(true, null, createElement(Child))).not.toThrow();
    expect(() => render(false, 'failed', createElement(Child))).not.toThrow();
  });
  it('allows a genuine zero after a successful read', () => {
    const html = render(false, null, createElement('p', null, '0 طلب'));
    expect(html).toContain('0 طلب');
    expect(html).not.toContain('جارٍ تحميل');
  });
  it('restores available actions only on success', () => {
    expect(render(false)).toContain('<button>تنفيذ طلب</button>');
  });
});
