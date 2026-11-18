import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { EVALUATION_LAB_INVOICE_COLUMNS, invoiceRowsFromRpc } from '../loadCycleEvidence';

describe('evaluation lab: invoices read in one call', () => {
  it('maps each compact row to the table columns in the function order', () => {
    const rows = invoiceRowsFromRpc([
      ['a1', 's1', 250.5, 260, '9509', 'فرع شكري', 'حامد', '2026-11-10', '2026-11-10T19:15:00+00:00', 3, 4.5],
      ['a2', null, null, 120, '', 'فرع الشامي', null, '2026-11-11', null, null, null],
    ]);
    expect(rows[0]).toEqual({
      id: 'a1', staff_id: 's1', net_amount: 250.5, total_amount: 260, customer_code: '9509', branch: 'فرع شكري',
      delivery_staff: 'حامد', sale_date: '2026-11-10', invoice_datetime: '2026-11-10T19:15:00+00:00', line_items_count: 3, discount_amount: 4.5,
    });
    expect(rows[1]).toMatchObject({ staff_id: null, net_amount: null, total_amount: 120, invoice_datetime: null });
    expect(Object.keys(rows[1])).toEqual([...EVALUATION_LAB_INVOICE_COLUMNS]);
  });
  it('an empty cycle is no rows; an unexpected payload is an error, never zeros', () => {
    expect(invoiceRowsFromRpc([])).toEqual([]);
    expect(() => invoiceRowsFromRpc({ rows: [] })).toThrow();
  });
});
