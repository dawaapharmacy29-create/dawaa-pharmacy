import { describe, expect, it } from 'vitest';
import { headerNotificationBucket, selectHeaderNotifications } from './headerNotificationSelection';

describe('headerNotificationSelection', () => {
  it('keeps task/customer/review/system families represented', () => {
    const items = [
      { id: 't1', type: 'staff_task', priority: 'high', created_at: '2026-09-11T03:00:00Z' },
      { id: 't2', type: 'staff_task', priority: 'high', created_at: '2026-09-11T03:01:00Z' },
      { id: 'c1', type: 'vip_customer_silence', priority: 'urgent', created_at: '2026-09-11T03:02:00Z' },
      { id: 'c2', type: 'customer_followup', priority: 'high', created_at: '2026-09-11T03:03:00Z' },
      { id: 'c3', type: 'customer_request', priority: 'normal', created_at: '2026-09-11T03:04:00Z' },
      { id: 'r1', type: 'conversation_review', priority: 'high', created_at: '2026-09-11T03:05:00Z' },
      { id: 's1', type: 'system', priority: 'high', created_at: '2026-09-11T03:06:00Z' },
      { id: 's2', type: 'manager_alert', priority: 'high', created_at: '2026-09-11T03:07:00Z' },
      { id: 'o1', type: 'sales_target', priority: 'normal', created_at: '2026-09-11T03:08:00Z' },
      { id: 'o2', type: 'attendance', priority: 'normal', created_at: '2026-09-11T03:09:00Z' },
    ];

    const selected = selectHeaderNotifications(items, 10);
    expect(selected).toHaveLength(10);
    expect(selected.filter((item) => headerNotificationBucket(item) === 'tasks')).toHaveLength(2);
    expect(selected.filter((item) => headerNotificationBucket(item) === 'reviews')).toHaveLength(1);
    expect(selected.some((item) => headerNotificationBucket(item) === 'customers')).toBe(true);
    expect(selected.some((item) => headerNotificationBucket(item) === 'system')).toBe(true);
  });

  it('maps legacy Team Alpha task wording into the task bucket', () => {
    expect(headerNotificationBucket({ type: 'system', title: 'فريق دواء ألفا — مهمة اليوم' })).toBe('tasks');
  });
});
