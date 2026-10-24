// The doctor commercial cycle reader must read both stored raw_data shapes of
// sales_invoice_items_v21 through the shared parser. A compact B-Connect row's return used to be
// ignored, so a returned unit still counted as sold quantity.
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { buildDoctorCommercialLineFactV1 } from '../doctorCommercialCycleRepositoryV1';

const header = {
  id: 'inv-1',
  branch_name: 'فرع شكري',
  staff_id: 'staff-1',
  staff_name: 'د محمد شبل',
  invoice_datetime: '2026-09-27T22:06:00Z',
};

describe('doctor commercial cycle line fact', () => {
  it('importer shape keeps its stored effective quantity, gross and allocated discount', () => {
    const fact = buildDoctorCommercialLineFactV1(
      {
        invoice_id: 'inv-1',
        invoice_number: '74938',
        product_code: '78994',
        quantity: 3,
        unit_price: 100,
        line_total: 250,
        raw_data: {
          __dawaa_commercial: {
            returned_quantity: 1,
            effective_quantity: 2,
            gross_line_amount: 300,
            effective_gross_after_return: 200,
            net_line_amount: 180,
            item_discount_amount: 20,
            allocated_invoice_discount_amount: 25,
          },
        },
      },
      header,
      []
    );
    expect(fact).toMatchObject({
      quantity: 2,
      returnedQuantity: 1,
      grossLineAmount: 200,
      netLineAmount: 180,
      itemDiscountAmount: 20,
      staffId: 'staff-1',
    });
  });

  it('compact B-Connect shape subtracts its returns and keeps its line discount and gross', () => {
    const fact = buildDoctorCommercialLineFactV1(
      {
        invoice_id: 'inv-1',
        invoice_number: '74938',
        product_code: '81948',
        quantity: 3,
        unit_price: 92,
        line_total: 128.78,
        raw_data: {
          gross_line: 276,
          line_discount: 10,
          line_discount_pct: 3.6,
          returned: 1,
          invoice_net: 849,
          unit: 'علبة',
          expiry: '.',
        },
      },
      header,
      []
    );
    expect(fact.returnedQuantity).toBe(1);
    expect(fact.quantity).toBe(2);
    // Gross after returns is pro-rated from the stored gross; net is the row's own line_total.
    expect(fact.grossLineAmount).toBeCloseTo(184, 6);
    expect(fact.netLineAmount).toBe(128.78);
    expect(fact.itemDiscountAmount).toBe(10);
  });

  it('a row with neither shape derives nothing it does not carry', () => {
    const fact = buildDoctorCommercialLineFactV1(
      {
        invoice_id: 'inv-1',
        invoice_number: '1',
        product_code: 'x',
        quantity: 2,
        unit_price: 5,
        line_total: 10,
        raw_data: {},
      },
      null,
      []
    );
    expect(fact).toMatchObject({
      quantity: 2,
      returnedQuantity: null,
      grossLineAmount: null,
      netLineAmount: 10,
      itemDiscountAmount: null,
      staffId: null,
    });
  });
});
