import { describe, expect, it } from 'vitest';
import { hasUnresolvedQuickReplyFields, renderQuickReplyTemplate, scriptTypeGroupLabel } from '../quickReplyScripts';

describe('customer quick reply protocol', () => {
  it('preserves approved paragraph spacing and fills verified order values', () => {
    const message = 'تمام يا فندم 🌷\n\n{{order_items}}\n\nالإجمالي: {{order_total}}';
    const rendered = renderQuickReplyTemplate(message, { order_items: 'دواء × 2', order_total: '150 ج' });
    expect(rendered).toBe('تمام يا فندم 🌷\n\nدواء × 2\n\nالإجمالي: 150 ج');
    expect(hasUnresolvedQuickReplyFields(rendered)).toBe(false);
  });

  it('blocks unknown order values and missing pharmacist identity', () => {
    expect(hasUnresolvedQuickReplyFields(renderQuickReplyTemplate('{{order_items}} - {{order_total}}', {}))).toBe(true);
    expect(hasUnresolvedQuickReplyFields(renderQuickReplyTemplate('مع حضرتك د/ {{doctor_name}}', {}))).toBe(true);
    expect(hasUnresolvedQuickReplyFields('تم تجهيز {order_total}')).toBe(true);
  });

  it('places new approved categories in the correct protocol groups', () => {
    expect(scriptTypeGroupLabel('doctor_welcome')).toContain('خدمة العملاء');
    expect(scriptTypeGroupLabel('order_preparation')).toContain('الطلبات');
  });
});
