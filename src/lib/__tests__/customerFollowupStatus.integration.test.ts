import { describe, expect, it } from 'vitest';
import {
  buildCustomerIdentity,
  isCompletedFollowup,
  isOpenFollowupResult,
} from '@/lib/customerFollowupCore';

type Row = Record<string, unknown>;

function groupOpen(rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    if (isCompletedFollowup(row)) continue;
    const key = buildCustomerIdentity({
      customerId: String(row.customer_id || ''),
      customerCode: String(row.customer_code || ''),
      phone: String(row.phone || row.customer_phone || ''),
      name: String(row.customer_name || ''),
    });
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }
  return grouped;
}

describe('customer followup queue integration rules', () => {
  it('keeps completed rows out of the open queue', () => {
    const grouped = groupOpen([
      { id: '1', customer_id: 'c1', followup_result: 'تم الرد والعميل راضي', completed_at: '2026-07-20' },
      { id: '2', customer_id: 'c2', followup_result: 'لم يرد' },
    ]);
    expect(grouped.has('id:c1')).toBe(false);
    expect(grouped.has('id:c2')).toBe(true);
  });

  it('groups two open requests for the same customer into one case', () => {
    const grouped = groupOpen([
      { id: '1', customer_id: 'c1', customer_code: '10', followup_result: 'لم يرد' },
      { id: '2', customer_id: 'c1', phone: '01007524265', followup_result: 'موعد قادم' },
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.get('id:c1')?.length).toBe(2);
  });

  it('recognizes legacy open statuses', () => {
    expect(isOpenFollowupResult('pending')).toBe(true);
    expect(isOpenFollowupResult('scheduled')).toBe(true);
  });
});
