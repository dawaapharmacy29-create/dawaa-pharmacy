import { describe, expect, it } from 'vitest';
import { completeRequestCounts, customerKey } from '../groupRequests';

describe('group customer requests', () => {
  it('reads the customer from the code, else the phone', () => {
    expect(customerKey('4966', null)).toBe('c:4966');
    expect(customerKey('٦٦٥٢', null)).toBe('c:6652');
    expect(customerKey('01102486496', null)).toBe('p:1102486496');
    expect(customerKey('00', '+20 1102486496')).toBe('p:1102486496');
    expect(customerKey(null, '123')).toBe('');
  });

  it('adds group requests to the app ones and counts the same customer on the same day once', () => {
    const app = [
      // 2026-10-29 21:00 Cairo.
      {
        recordedStaffId: 'a',
        createdAt: '2026-10-29T19:00:00Z',
        customerCode: '4966',
        medicineName: 'x',
        status: 'new',
      },
      {
        recordedStaffId: 'a',
        createdAt: '2026-10-29T19:00:00Z',
        customerCode: '5000',
        medicineName: 'x',
        status: 'cancelled',
      },
    ];
    const group = [
      { staffId: 'b', branch: null, day: '2026-10-29', customerCode: '4966', customerPhone: null },
      { staffId: 'b', branch: null, day: '2026-10-30', customerCode: '4966', customerPhone: null },
      { staffId: 'b', branch: null, day: '2026-10-30', customerCode: '4966', customerPhone: null },
      { staffId: null, branch: null, day: '2026-10-31', customerCode: '7000', customerPhone: null },
      { staffId: 'b', branch: null, day: '2026-10-31', customerCode: null, customerPhone: null },
    ];
    const counts = completeRequestCounts(app, group);
    expect(counts.get('a')).toBe(1);
    expect(counts.get('b')).toBe(1);
  });

  it('works with no group rows', () => {
    expect(completeRequestCounts([], null).size).toBe(0);
  });
});
