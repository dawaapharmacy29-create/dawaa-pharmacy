import { describe, expect, it } from 'vitest';
import type { AccountantTransaction } from '../accountantReport';
import {
  compareShiftsWithLedger,
  comparisonTotals,
  type HandoverShift,
} from '../shiftLedgerComparison';

const shift = (over: Partial<HandoverShift>): HandoverShift => ({
  id: Math.random().toString(36),
  branch: 'فرع شكري',
  shift_type: 'صباحي',
  shift_date: '2026-11-01',
  submitted_by: null,
  cash_sales: 0,
  cash_handover: null,
  visa_sales: 0,
  insta_sales: 0,
  vodafone_sales: 0,
  is_archived: false,
  ...over,
});
const tx = (over: Partial<AccountantTransaction>): AccountantTransaction => ({
  id: Math.random().toString(36),
  vault_code: 'shokry',
  date: '2026-11-01',
  direction: 'in',
  amount: 0,
  classification: 'مبيعات',
  category_name: 'مبيعات',
  description: null,
  created_by_name: null,
  running_balance: 0,
  is_offset_pair: false,
  source_details: {},
  ...over,
});

describe('compareShiftsWithLedger', () => {
  it('compares handed cash and transfers per day and carries the running difference', () => {
    const days = compareShiftsWithLedger(
      [
        tx({ amount: 500 }),
        tx({ date: '2026-11-02', amount: 900 }),
        tx({ amount: 70, classification: 'تحصيل الكتروني', category_name: 'انستا' }),
        tx({ amount: 999, direction: 'out', classification: 'مرتبات' }),
        tx({ amount: 40, vault_code: 'shamy' }),
      ],
      [
        shift({ cash_sales: 600, cash_handover: 550, insta_sales: 70 }),
        shift({ shift_type: 'مسائي', cash_sales: 300 }),
        shift({ shift_date: '2026-11-02', cash_sales: 50 }),
        shift({ cash_sales: 1000, is_archived: true }),
        shift({ branch: 'فرع الشامي', cash_sales: 40 }),
      ],
      ['shokry'],
      '2026-11',
      '2026-11-03'
    );
    expect(days.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(days[0]).toMatchObject({
      shiftCash: 850,
      ledgerCash: 500,
      cashDiff: 350,
      shiftElectronic: 70,
      ledgerElectronic: 70,
      electronicDiff: 0,
      mismatch: true,
    });
    expect(days[1]).toMatchObject({ cashDiff: -850, cashRunning: -500 });
    expect(days[2]).toMatchObject({ mismatch: false, cashRunning: -500 });
    expect(comparisonTotals(days)).toMatchObject({ shifts: 3, mismatchDays: 2 });
  });

  it('adds both branches when all vaults are chosen and ignores the other-branches vault', () => {
    const days = compareShiftsWithLedger(
      [tx({ amount: 40, vault_code: 'shamy' }), tx({ amount: 77, vault_code: 'other' })],
      [shift({ cash_sales: 10 }), shift({ branch: 'فرع الشامي', cash_sales: 30 })],
      ['shamy', 'shokry', 'other'],
      '2026-11',
      '2026-11-01'
    );
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ shiftCash: 40, ledgerCash: 40, mismatch: false });
  });
});
