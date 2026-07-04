import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildInvoiceDuplicateIdentity, importInvoicesToDB, loadDatabaseDayComparison, parseInvoiceDate } from '@/lib/invoiceImporter';
import { getInvoiceAmount, getInvoiceBranch, getInvoiceDay, getInvoiceId, getInvoiceSellerName } from '@/lib/invoices/invoiceCore';

const mockSelect = vi.fn();
const mockGte = vi.fn();
const mockLt = vi.fn();
let mockDatabaseRows = [];
let currentTable = '';
let lastSelect = '';
let lastInsertPayload = [];
let lastUpdatePayload = null;

const chain = {
  select(select) {
    mockSelect(select);
    lastSelect = select;
    return chain;
  },
  gte(field, value) {
    mockGte(field, value);
    return chain;
  },
  lt(field, value) {
    mockLt(field, value);
    return chain;
  },
  in(_field, _values) {
    return chain;
  },
  eq(_field, _value) {
    return chain;
  },
  order(_column: string, _options: { ascending: boolean }) {
    return chain;
  },
  maybeSingle: async () => ({ data: null, error: null }),
  limit: async () => {
    if (currentTable === 'sales_invoices' && lastSelect.startsWith('id, branch, invoice_no')) {
      return { data: [], error: null };
    }
    return { data: mockDatabaseRows, error: null };
  },
  insert: async (rows) => {
    lastInsertPayload = rows;
    if (currentTable === 'sales_invoices') {
      return { data: rows, error: null };
    }
    return { data: null, error: null };
  },
  update: async (row) => {
    lastUpdatePayload = row;
    return { data: [], error: null };
  },
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      currentTable = table;
      return chain;
    },
  },
}));

describe('buildInvoiceDuplicateIdentity', () => {
  it('uses invoice number, branch and date to create a stable duplicate key', () => {
    expect(buildInvoiceDuplicateIdentity('INV-100', 'فرع شكري', '2026-07-01')).toBe(
      'INV-100|فرع شكري|2026-07-01'
    );
  });

  it('normalizes empty branch and trims values', () => {
    expect(buildInvoiceDuplicateIdentity('  INV-200  ', '  ', '2026-07-02')).toBe(
      'INV-200|غير محدد|2026-07-02'
    );
  });

  it('treats branch aliases as the same normalized branch and normalizes date values', () => {
    const key1 = buildInvoiceDuplicateIdentity('INV-300', 'شكري', '02/07/2026');
    const key2 = buildInvoiceDuplicateIdentity('INV-300', 'فرع شكري', '2026-07-02T08:15:00Z');
    expect(key1).toBe(key2);
  });

  it('returns different keys for same invoice number with different dates or branches', () => {
    const baseKey = buildInvoiceDuplicateIdentity('INV-400', 'فرع شكري', '2026-07-02');
    const differentDateKey = buildInvoiceDuplicateIdentity('INV-400', 'فرع شكري', '2026-07-03');
    const differentBranchKey = buildInvoiceDuplicateIdentity('INV-400', 'فرع الشامي', '2026-07-02');

    expect(differentDateKey).not.toBe(baseKey);
    expect(differentBranchKey).not.toBe(baseKey);
  });

  it('does not treat blank invoice numbers as the same invoice across different dates or normalized branches', () => {
    const keyA = buildInvoiceDuplicateIdentity('', 'فرع شكري', '2026-07-02');
    const keyB = buildInvoiceDuplicateIdentity('', 'فرع الشامي', '2026-07-02');
    const keyC = buildInvoiceDuplicateIdentity('', 'فرع شكري', '2026-07-03');

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });
});

describe('parseInvoiceDate', () => {
  it('parses Egyptian dd/mm/yyyy dates without swapping day and month', () => {
    expect(parseInvoiceDate('02/07/2026')).toBe('2026-07-02');
    expect(parseInvoiceDate('03/07/2026')).toBe('2026-07-03');
  });

  it('supports dd-mm-yyyy, ISO dates, and Excel serial dates', () => {
    expect(parseInvoiceDate('2-7-2026')).toBe('2026-07-02');
    expect(parseInvoiceDate('2026-07-02')).toBe('2026-07-02');
    expect(parseInvoiceDate(46205)).toBe('2026-07-02');
    expect(parseInvoiceDate('46205')).toBe('2026-07-02');
    expect(parseInvoiceDate('2026-07-02T08:15:00Z')).toBe('2026-07-02');
  });
});

describe('invoiceCore helpers', () => {
  it('uses one canonical day parser across invoice fields', () => {
    expect(getInvoiceDay({ sale_date: '02/07/2026' })).toBe('2026-07-02');
    expect(getInvoiceDay({ invoice_datetime: '03/07/2026 14:30' })).toBe('2026-07-03');
  });

  it('prefers net amount fields in the expected order', () => {
    expect(getInvoiceAmount({ net_amount: 120, net_total: 90, amount: 80 })).toBe(120);
    expect(getInvoiceAmount({ net_total: 90, total_amount: 80, amount: 70 })).toBe(90);
    expect(getInvoiceAmount({ total_amount: 80, amount: 70 })).toBe(80);
    expect(getInvoiceAmount({ amount: 70, gross_amount: 100 })).toBe(70);
  });

  it('normalizes invoice id, branch and seller name', () => {
    expect(getInvoiceId({ invoice_number: '  A-1  ', invoice_no: 'B-2' })).toBe('A-1');
    expect(getInvoiceBranch({ branch: 'shokry' })).toBe('فرع شكري');
    expect(getInvoiceBranch({ branch_name: 'الشامي' })).toBe('فرع الشامي');
    expect(getInvoiceSellerName({ staff_name: 'د/ سارة', seller_name: 'د/ بسنت' })).toBe('د/ سارة');
  });
});

describe('loadDatabaseDayComparison', () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockGte.mockReset();
    mockLt.mockReset();
    mockDatabaseRows = [];
  });

  it('marks a day as matched when a file day exists in sales_invoices after import', async () => {
    mockDatabaseRows = [
      {
        invoice_date: '2026-07-03',
        invoice_number: 'INV-1',
        invoice_no: 'INV-1',
        branch: 'فرع شكري',
        net_amount: 7367.4,
        amount: 7367.4,
        discounted_amount: 7367.4,
        gross_amount: 7367.4,
        branch_name: 'فرع شكري',
      },
      {
        invoice_date: '2026-07-03',
        invoice_number: 'INV-2',
        invoice_no: 'INV-2',
        branch: 'فرع الشامي',
        net_amount: 1992.15,
        amount: 1992.15,
        discounted_amount: 1992.15,
        gross_amount: 1992.15,
        branch_name: 'فرع الشامي',
      },
    ];

    const fileDays = new Map([
      ['2026-07-03', { date: '2026-07-03', count: 2, total: 9359.55 }],
    ]);

    const result = await loadDatabaseDayComparison(fileDays, '2026-07-03', '2026-07-03');

    expect(mockGte).toHaveBeenCalledWith('invoice_date', '2026-07-03');
    expect(mockLt).toHaveBeenCalledWith('invoice_date', '2026-07-04');
    expect(result.comparison).toHaveLength(1);
    expect(result.comparison[0].date).toBe('2026-07-03');
    expect(result.comparison[0].status).toBe('matched');
    expect(result.comparison[0].databaseCount).toBe(2);
    expect(result.comparison[0].databaseTotal).toBeCloseTo(9359.55, 2);
  });

  it('imports and matches 2026-07-03 when the DB contains the same daily invoices', async () => {
    mockDatabaseRows = [
      {
        invoice_date: '2026-07-03',
        invoice_number: 'INV-1',
        invoice_no: 'INV-1',
        branch: 'فرع شكري',
        net_amount: 100,
        amount: 100,
        discounted_amount: 100,
        gross_amount: 100,
        branch_name: 'فرع شكري',
      },
      {
        invoice_date: '2026-07-03',
        invoice_number: 'INV-2',
        invoice_no: 'INV-2',
        branch: 'فرع الشامي',
        net_amount: 200,
        amount: 200,
        discounted_amount: 200,
        gross_amount: 200,
        branch_name: 'فرع الشامي',
      },
    ];

    const rows = [
      {
        rowIndex: 1,
        invoiceNumber: 'INV-1',
        customerCode: 'C1',
        name: 'Test',
        phone: '01000000001',
        amount: 100,
        grossAmount: 100,
        discountedAmount: 100,
        netAmount: 100,
        discountAmount: null,
        courierCash: null,
        extraFees: null,
        lineItemsCount: null,
        date: '2026-07-03',
        invoiceDateTime: '2026-07-03T10:00:00.000Z',
        closeDateTime: null,
        analysisDateTime: '2026-07-03T10:00:00.000Z',
        branch: 'فرع شكري',
        invoiceType: 'مبيعات',
        seller: 'د/ سارة',
        closeTime: null,
        deliveryStaff: '',
        specialty: '',
        clinic: '',
        deliveryAddress: '',
        notes: '',
        saveStatus: '',
        deviceName: '',
        customerLinkStatus: 'matched_by_file',
        importValidationStatus: 'valid',
        importWarning: null,
        raw: {},
      },
      {
        rowIndex: 2,
        invoiceNumber: 'INV-2',
        customerCode: 'C2',
        name: 'Test2',
        phone: '01000000002',
        amount: 200,
        grossAmount: 200,
        discountedAmount: 200,
        netAmount: 200,
        discountAmount: null,
        courierCash: null,
        extraFees: null,
        lineItemsCount: null,
        date: '2026-07-03',
        invoiceDateTime: '2026-07-03T11:00:00.000Z',
        closeDateTime: null,
        analysisDateTime: '2026-07-03T11:00:00.000Z',
        branch: 'فرع الشامي',
        invoiceType: 'مبيعات',
        seller: 'د/ أحمد',
        closeTime: null,
        deliveryStaff: '',
        specialty: '',
        clinic: '',
        deliveryAddress: '',
        notes: '',
        saveStatus: '',
        deviceName: '',
        customerLinkStatus: 'matched_by_file',
        importValidationStatus: 'valid',
        importWarning: null,
        raw: {},
      },
    ];

    const summary = await importInvoicesToDB(rows, 'فرع شكري', 'test-batch');

    expect(summary.parsedRowsByDate).toEqual([
      { date: '2026-07-03', count: 2, total: 300 },
    ]);
    expect(summary.savedRowsByDate).toEqual([
      { date: '2026-07-03', count: 2, total: 300 },
    ]);
    expect(summary.databaseByDay).toEqual([
      { date: '2026-07-03', count: 2, total: 300 },
    ]);
    expect(summary.dayDatabaseComparison?.[0]).toMatchObject({
      date: '2026-07-03',
      status: 'matched',
      fileCount: 2,
      fileTotal: 300,
      databaseCount: 2,
      databaseTotal: 300,
      countDifference: 0,
      difference: 0,
    });
    expect(summary.databaseComparisonQuery).toMatchObject({
      table: 'sales_invoices',
      dateColumn: 'invoice_date',
      gte: '2026-07-03',
      lt: '2026-07-04',
      fileMinDate: '2026-07-03',
      fileMaxDate: '2026-07-03',
    });
    expect(summary.savedRowsSample?.length).toBeGreaterThanOrEqual(2);
    expect(summary.skippedRowsSample?.length).toBe(0);
  });
});
