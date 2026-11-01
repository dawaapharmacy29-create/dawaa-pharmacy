import { describe, it, expect } from 'vitest';
import { resolveAccountantSnapshot } from '../../../supabase/functions/base44-accountant-sync/snapshot';
import {
  accountantExportText,
  accountantFilter,
  accountantHistoryRows,
  type AccountantTransaction,
} from '../accountantReport';
describe('Dawaa Bills accountant parity', () => {
  it('resolves original description aliases before categories and preserves per-movement overrides', () => {
    const t = {
      id: 't',
      direction: 'out',
      category_id: 'c',
      category_name: 'قديم',
      category_group: 'شركات',
      description: 'بيان معدل',
      original_description: '  مورد   قديم ',
    };
    const aliases = [
      {
        id: 'a',
        source_key: 'out|مورد قديم',
        target_name: 'المورد الموحد',
        group: 'مخازن',
        updated_date: '2026-10-01',
      },
      {
        id: 'b',
        source_key: 'out|مورد قديم',
        target_name: 'المورد الصحيح',
        group: 'رواتب',
        updated_date: '2026-11-01',
      },
    ];
    const [resolved] = resolveAccountantSnapshot(
      [t],
      [{ id: 'c', name: 'اسم الدليل', group: 'مصروفات ادارية' }],
      aliases
    );
    expect(resolved.category_name).toBe('المورد الصحيح');
    expect(resolved.category_group).toBe('مرتبات');
    expect(resolved.original_description).toBe(t.original_description);
    const [overridden] = resolveAccountantSnapshot(
      [{ ...t, classification_override: 'أرباح' }],
      [],
      aliases
    );
    expect(overridden.category_group).toBe('ارباح');
    expect(overridden.source_classification_override).toBe('أرباح');
    expect(overridden.classification_override).toBeNull();
  });
  it('does not apply outgoing groups to incoming movements', () => {
    expect(
      resolveAccountantSnapshot([{ direction: 'in', category_group: 'مرتبات' }], [], [])[0]
        .category_group
    ).toBe('غير مصنف');
  });
  it('does not fabricate an aggregate opening when one treasury has an unknown opening', () => {
    expect(
      accountantHistoryRows(
        [
          { month: '2026-11', vault_code: 'a', opening: 100, incoming: 20, outgoing: 10, count: 2 },
          { month: '2026-11', vault_code: 'b', opening: null, incoming: 1, outgoing: 0, count: 1 },
        ],
        null
      )[0]
    ).toEqual({ month: '2026-11', opening: null, incoming: 21, outgoing: 10, count: 3 });
  });
  it('filters original descriptions without recalculating running balances', () => {
    const row = {
      id: 'x',
      date: '2026-11-01',
      vault_code: 'a',
      direction: 'out',
      classification: 'شركات',
      running_balance: 900,
      source_details: { original_description: 'البيان الأصلي' },
    } as AccountantTransaction;
    expect(
      accountantFilter([row], {
        vault: 'a',
        direction: 'out',
        category: 'شركات',
        query: 'الأصلي',
        from: '2026-11-01',
        to: '2026-11-02',
      })[0].running_balance
    ).toBe(900);
  });
  it('exports user text as text even when it begins with spreadsheet formulas', () => {
    for (const text of ['=1+1', '+cmd', '-formula', '@SUM(A1)', '\t=1'])
      expect(accountantExportText(text)).toBe("'" + text);
    expect(accountantExportText('شركة')).toBe('شركة');
  });
});
