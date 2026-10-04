import { describe, expect, it } from 'vitest';
import { filterPerformanceScope, staffMatchesPerformanceScope } from '@/lib/performance/performanceScope';

const rows = [
  { id: 'd1', role: 'pharmacist', branch: 'الشامي' },
  { id: 'd2', role: 'دكتور', branch: 'شكري' },
  { id: 'r1', role: 'مندوب توصيل', branch: 'الشامي' },
  { id: 'w1', role: 'inventory_assistant', branch: 'المخزن' },
  { id: 'w2', role: 'warehouse', branch: 'المخزن' },
];

describe('performance scope resolver', () => {
  it('keeps branch grouping independent from role grouping', () => {
    expect(filterPerformanceScope(rows, 'branch', 'الشامي').map(x => x.id)).toEqual(['d1','r1']);
    expect(filterPerformanceScope(rows, 'branch', 'فرع شكري').map(x => x.id)).toEqual(['d2']);
  });
  it('isolates doctors, delivery and warehouse deterministically', () => {
    expect(filterPerformanceScope(rows, 'doctors').map(x => x.id)).toEqual(['d1','d2']);
    expect(filterPerformanceScope(rows, 'delivery').map(x => x.id)).toEqual(['r1']);
    expect(filterPerformanceScope(rows, 'warehouse').map(x => x.id)).toEqual(['w1','w2']);
  });
  it('does not classify unrelated roles into warehouse', () => {
    expect(staffMatchesPerformanceScope(rows[0], 'warehouse')).toBe(false);
  });
});
