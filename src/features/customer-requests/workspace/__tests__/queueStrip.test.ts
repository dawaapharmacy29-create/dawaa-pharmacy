import { describe, expect, it } from 'vitest';
import { customerRequestQueues } from '../CustomerRequestQueueStrip';
import type { CustomerRequestCommandSummary } from '../../data';

describe('customer request queue strip', () => {
  it('puts the work queues first and keeps the day filters as small chips', () => {
    const { work, more } = customerRequestQueues({
      attention: 53,
      urgent: 16,
      ready: 26,
      followup_due: 0,
      unassigned: 11,
      today: 0,
      overdue: 233,
      delivered: 185,
      moved_to_shortage: 1,
    } as unknown as CustomerRequestCommandSummary);
    expect(work.map((item) => [item.label, item.count])).toEqual([
      ['يحتاج إجراء', 53],
      ['عاجل', 16],
      ['جاهز للتواصل', 26],
      ['متابعة مستحقة', 0],
      ['بدون مسئول', 11],
    ]);
    expect(more.map((item) => item.label)).toEqual(['اليوم', 'أمس', 'متأخر', 'النواقص', 'تمت']);
    expect(more.find((item) => item.key === 'yesterday')?.count).toBeNull();
  });
});
