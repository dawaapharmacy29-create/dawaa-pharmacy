import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildInvoiceDuplicateIdentity, importInvoicesToDB, loadDatabaseDayComparison, parseInvoiceDate } from '@/lib/invoiceImporter';
import { getInvoiceAmount, getInvoiceBranch, getInvoiceDay, getInvoiceId, getInvoiceSellerName } from '@/lib/invoices/invoiceCore';

const mockSelect = vi.fn();
const mockGte = vi.fn();
const mockLt = vi.fn();
let mockDatabaseRows = [];
let mockExistingInvoiceRows = [];
let mockInsertImplementation: ((rows: any[]) => Promise<{ data: any[] | null; error: { message: string } | null }>) | null = null;
let currentTable = '';
let lastSelect = '';
let lastInsertPayload = [];
let lastSalesInvoiceInsertPayload = [];
let lastUpdatePayload = null;
let isUpdateChain = false;

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
    if (isUpdateChain) {
      isUpdateChain = false;
      return Promise.resolve({ data: [], error: null });
    }
    return chain;
  },
  order(_column: string, _options: { ascending: boolean }) {
    return chain;
  },
  maybeSingle: async () => ({ data: null, error: null }),
  limit: async () => {
    if (currentTable === 'sales_invoices' && lastSelect.startsWith('id, branch, invoice_no')) {
      return { data: mockExistingInvoiceRows, error: null };
    }
    return { data: mockDatabaseRows, error: null };
  },
  insert: async (rows) => {
    lastInsertPayload = rows;
    if (currentTable === 'sales_invoices') {
      lastSalesInvoiceInsertPayload = rows;
      if (mockInsertImplementation) return mockInsertImplementation(rows);
      return { data: rows, error: null };
    }
    return { data: null, error: null };
  },
  update: (row) => {
    lastUpdatePayload = row;
    isUpdateChain = true;
    return chain;
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

function makeInvoiceRow(overrides: Partial<any> = {}) {
  const index = overrides.rowIndex ?? 1;
  const date = overrides.date ?? '2026-07-03';
  const amount = overrides.amount ?? 100;
  return {
    rowIndex: index,
    invoiceNumber: overrides.invoiceNumber ?? `INV-${index}`,
    customerCode: overrides.customerCode ?? `C${index}`,
    name: overrides.name ?? `Customer ${index}`,
    phone: overrides.phone ?? `0100000000${index}`,
    amount,
    grossAmount: overrides.grossAmount ?? amount,
    discountedAmount: overrides.discountedAmount ?? amount,
    netAmount: overrides.netAmount ?? amount,
    discountAmount: null,
    courierCash: null,
    extraFees: null,
    lineItemsCount: null,
    date,
    invoiceDateTime: `${date}T10:00:00.000Z`,
    closeDateTime: null,
    analysisDateTime: `${date}T10:00:00.000Z`,
    branch: overrides.branch ?? 'ÙØ±Ø¹ Ø´ÙƒØ±ÙŠ',
    invoiceType: overrides.invoiceType ?? 'Ù…Ø¨ÙŠØ¹Ø§Øª',
    seller: overrides.seller ?? 'Ø¯/ Ø³Ø§Ø±Ø©',
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
    ...overrides,
  };
}

beforeEach(() => {
  mockSelect.mockReset();
  mockGte.mockReset();
  mockLt.mockReset();
  mockDatabaseRows = [];
  mockExistingInvoiceRows = [];
  mockInsertImplementation = null;
  currentTable = '';
  lastSelect = '';
  lastInsertPayload = [];
  lastSalesInvoiceInsertPayload = [];
  lastUpdatePayload = null;
  isUpdateChain = false;
});

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

  it('tracks prepared, sent and saved invoices across Egyptian, ISO and Excel date inputs', async () => {
    const specs = [
      { invoiceNumber: 'JUL-2', rawDate: '02/07/2026', amount: 100 },
      { invoiceNumber: 'JUL-3', rawDate: '03/07/2026', amount: 200 },
      { invoiceNumber: 'ISO-4', rawDate: '2026-07-04', amount: 300 },
      { invoiceNumber: 'XLS-2', rawDate: 46205, amount: 400 },
    ];
    const rows = specs.map((spec, index) => {
      const date = parseInvoiceDate(spec.rawDate)!;
      return {
        rowIndex: index + 1,
        invoiceNumber: spec.invoiceNumber,
        customerCode: `C${index + 1}`,
        name: `Customer ${index + 1}`,
        phone: `0100000000${index + 1}`,
        amount: spec.amount,
        grossAmount: spec.amount,
        discountedAmount: spec.amount,
        netAmount: spec.amount,
        discountAmount: null,
        courierCash: null,
        extraFees: null,
        lineItemsCount: null,
        date,
        invoiceDateTime: `${date}T10:00:00.000Z`,
        closeDateTime: null,
        analysisDateTime: `${date}T10:00:00.000Z`,
        branch: 'ÙØ±Ø¹ Ø´ÙƒØ±ÙŠ',
        invoiceType: 'Ù…Ø¨ÙŠØ¹Ø§Øª',
        seller: 'Ø¯/ Ø³Ø§Ø±Ø©',
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
        raw: { rawDate: spec.rawDate },
      };
    });

    mockDatabaseRows = rows.map((row) => ({
      invoice_date: row.date,
      invoice_number: row.invoiceNumber,
      invoice_no: row.invoiceNumber,
      branch: row.branch,
      net_amount: row.netAmount,
      amount: row.amount,
      discounted_amount: row.discountedAmount,
      gross_amount: row.grossAmount,
    }));

    const summary = await importInvoicesToDB(rows, 'ÙØ±Ø¹ Ø´ÙƒØ±ÙŠ', 'multi-day-batch');

    expect(summary.parsedRowsByDate).toEqual([
      { date: '2026-07-02', count: 2, total: 500 },
      { date: '2026-07-03', count: 1, total: 200 },
      { date: '2026-07-04', count: 1, total: 300 },
    ]);
    expect(summary.rowsPreparedForSaveCount).toBe(4);
    expect(summary.rowsActuallySentToSupabaseCount).toBe(4);
    expect(summary.rowsSavedSuccessfullyCount).toBe(4);
    expect(summary.rowsFailedToSaveCount).toBe(0);
    expect(summary.rowsSaveNotAttemptedCount).toBe(0);
    expect(summary.rowSaveTrace?.every((row) => row.finalStatus === 'saved')).toBe(true);
    expect(summary.dayDatabaseComparison?.map((row) => row.status)).toEqual([
      'matched',
      'matched',
      'matched',
    ]);
  });

  it('splits timeout batches and keeps saving rows that can persist', async () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      makeInvoiceRow({
        rowIndex: index + 1,
        invoiceNumber: `TIMEOUT-${index + 1}`,
        amount: 100,
        date: index < 25 ? '2026-07-04' : '2026-07-05',
      })
    );
    mockInsertImplementation = async (payload) => {
      if (payload.length > 1) {
        return { data: null, error: { message: 'canceling statement due to statement timeout' } };
      }
      if (payload[0]?.invoice_number === 'TIMEOUT-5') {
        return { data: null, error: { message: 'canceling statement due to statement timeout' } };
      }
      return { data: payload, error: null };
    };
    mockDatabaseRows = rows
      .filter((row) => row.invoiceNumber !== 'TIMEOUT-5')
      .map((row) => ({
        invoice_date: row.date,
        invoice_number: row.invoiceNumber,
        invoice_no: row.invoiceNumber,
        branch: row.branch,
        net_amount: row.netAmount,
        amount: row.amount,
      }));

    const summary = await importInvoicesToDB(rows, 'ÙØ±Ø¹ Ø´ÙƒØ±ÙŠ', 'timeout-batch');

    expect(summary.rowsPreparedForSaveCount).toBe(30);
    expect(summary.rowsActuallySentToSupabaseCount).toBe(30);
    expect(summary.rowsSavedSuccessfullyCount).toBe(29);
    expect(summary.rowsFailedToSaveCount).toBe(1);
    expect(summary.rowSaveTrace?.find((row) => row.invoice_number === 'TIMEOUT-5')).toMatchObject({
      saveAttempted: true,
      saveSucceeded: false,
      finalStatus: 'supabase_insert_timeout',
    });
    expect(summary.saveBatchReports?.some((batch) => batch.batchError?.includes('split into single-row retries'))).toBe(true);
  });

  it('retries transient timeout errors and succeeds without marking rows failed', async () => {
    const rows = [makeInvoiceRow({ rowIndex: 1, invoiceNumber: 'RETRY-1' }), makeInvoiceRow({ rowIndex: 2, invoiceNumber: 'RETRY-2' })];
    let attempts = 0;
    mockInsertImplementation = async (payload) => {
      attempts += 1;
      if (attempts === 1) {
        return { data: null, error: { message: 'canceling statement due to statement timeout' } };
      }
      return { data: payload, error: null };
    };
    mockDatabaseRows = rows.map((row) => ({
      invoice_date: row.date,
      invoice_number: row.invoiceNumber,
      invoice_no: row.invoiceNumber,
      branch: row.branch,
      net_amount: row.netAmount,
      amount: row.amount,
    }));

    const summary = await importInvoicesToDB(rows, 'ÙØ±Ø¹ Ø´ÙƒØ±ÙŠ', 'retry-batch');

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(summary.rowsSavedSuccessfullyCount).toBe(2);
    expect(summary.rowsFailedToSaveCount).toBe(0);
    expect(summary.rowSaveTrace?.every((row) => row.finalStatus === 'saved')).toBe(true);
  });

  it('detects missing days after import verification', async () => {
    const rows = [
      makeInvoiceRow({ rowIndex: 1, invoiceNumber: 'MISS-4', date: '2026-07-04', amount: 100 }),
      makeInvoiceRow({ rowIndex: 2, invoiceNumber: 'MISS-5', date: '2026-07-05', amount: 200 }),
    ];
    mockDatabaseRows = [
      {
        invoice_date: '2026-07-04',
        invoice_number: 'MISS-4',
        invoice_no: 'MISS-4',
        branch: rows[0].branch,
        net_amount: 100,
        amount: 100,
      },
    ];

    const summary = await importInvoicesToDB(rows, 'ÙØ±Ø¹ Ø´ÙƒØ±ÙŠ', 'missing-day-batch');

    expect(summary.dayDatabaseComparison?.find((row) => row.date === '2026-07-04')?.status).toBe('matched');
    expect(summary.dayDatabaseComparison?.find((row) => row.date === '2026-07-05')?.status).toBe('missing_in_database');
    expect(summary.missingDaysInDatabase).toEqual([{ date: '2026-07-05', count: 1, total: 200 }]);
  });

  it('keeps re-import idempotent by updating existing same invoice/branch/date instead of inserting', async () => {
    const rows = [makeInvoiceRow({ rowIndex: 1, invoiceNumber: 'IDEMP-1', date: '2026-07-04', amount: 150 })];
    mockExistingInvoiceRows = [
      {
        id: 'existing-1',
        invoice_date: '2026-07-04',
        invoice_number: 'IDEMP-1',
        invoice_no: 'IDEMP-1',
        branch: rows[0].branch,
        net_amount: 150,
        amount: 150,
      },
    ];
    mockDatabaseRows = mockExistingInvoiceRows;

    const summary = await importInvoicesToDB(rows, 'ÙØ±Ø¹ Ø´ÙƒØ±ÙŠ', 'idempotent-batch');

    expect(summary.insertedRows).toBe(0);
    expect(summary.confirmedExistingInvoices).toBe(1);
    expect(summary.rowsSavedSuccessfullyCount).toBe(1);
    expect(lastInsertPayload).toEqual([]);
    expect(lastUpdatePayload).toMatchObject({ invoice_number: 'IDEMP-1' });
  });

  it('inserts same invoice_number on a different date instead of updating the old row', async () => {
    const row = makeInvoiceRow({ rowIndex: 1, invoiceNumber: 'SAME-NO', date: '2026-07-05', amount: 180 });
    mockExistingInvoiceRows = [
      {
        id: 'old-date',
        invoice_date: '2026-07-04',
        invoice_number: 'SAME-NO',
        invoice_no: 'SAME-NO',
        branch: row.branch,
        net_amount: 170,
        amount: 170,
      },
    ];
    mockDatabaseRows = [
      ...mockExistingInvoiceRows,
      {
        invoice_date: '2026-07-05',
        invoice_number: 'SAME-NO',
        invoice_no: 'SAME-NO',
        branch: row.branch,
        net_amount: 180,
        amount: 180,
      },
    ];

    const summary = await importInvoicesToDB([row], 'ÙØ±Ø¹ Ø´ÙƒØ±ÙŠ', 'same-number-new-date');

    expect(summary.insertedRows).toBe(1);
    expect(summary.confirmedExistingInvoices || 0).toBe(0);
    expect(lastUpdatePayload).toBeNull();
    expect(lastSalesInvoiceInsertPayload[0]).toMatchObject({
      invoice_number: 'SAME-NO',
      invoice_date: '2026-07-05',
      sale_date: '2026-07-05',
      date: '2026-07-05',
    });
  });

  it('inserts same invoice_number in a different branch instead of updating the old row', async () => {
    const row = makeInvoiceRow({
      rowIndex: 1,
      invoiceNumber: 'SAME-BRANCH-NO',
      date: '2026-07-05',
      branch: 'shamy',
      amount: 220,
    });
    mockExistingInvoiceRows = [
      {
        id: 'old-branch',
        invoice_date: '2026-07-05',
        invoice_number: 'SAME-BRANCH-NO',
        invoice_no: 'SAME-BRANCH-NO',
        branch: 'shokry',
        net_amount: 220,
        amount: 220,
      },
    ];
    mockDatabaseRows = [
      ...mockExistingInvoiceRows,
      {
        invoice_date: '2026-07-05',
        invoice_number: 'SAME-BRANCH-NO',
        invoice_no: 'SAME-BRANCH-NO',
        branch: row.branch,
        net_amount: 220,
        amount: 220,
      },
    ];

    const summary = await importInvoicesToDB([row], 'shamy', 'same-number-new-branch');

    expect(summary.insertedRows).toBe(1);
    expect(summary.confirmedExistingInvoices || 0).toBe(0);
    expect(lastUpdatePayload).toBeNull();
    expect(lastSalesInvoiceInsertPayload[0]).toMatchObject({
      invoice_number: 'SAME-BRANCH-NO',
      branch: 'shamy',
      invoice_date: '2026-07-05',
    });
  });

  it('marks saved rows that are not found by branch invoice_number and invoice_date after verification', async () => {
    const rows = [makeInvoiceRow({ rowIndex: 1, invoiceNumber: 'GHOST-1', date: '2026-07-05', amount: 300 })];
    mockDatabaseRows = [];

    const summary = await importInvoicesToDB(rows, 'ÙØ±Ø¹ Ø´ÙƒØ±ÙŠ', 'ghost-save');

    expect(summary.rowsSavedSuccessfullyCount).toBe(1);
    expect(summary.rowSaveTrace?.[0]).toMatchObject({
      invoice_number: 'GHOST-1',
      saveSucceeded: true,
      postSaveFound: false,
      finalStatus: 'saved_but_not_found_after_verification',
    });
    expect(summary.postSaveVerificationRows?.[0]).toMatchObject({
      invoice_number: 'GHOST-1',
      post_save_found: false,
      post_import_status: 'missing_day_in_database_after_import',
    });
  });

  it('detects partial days when database has fewer invoices than the file', async () => {
    const rows = [
      makeInvoiceRow({ rowIndex: 1, invoiceNumber: 'PART-1', date: '2026-07-03', amount: 100 }),
      makeInvoiceRow({ rowIndex: 2, invoiceNumber: 'PART-2', date: '2026-07-03', amount: 200 }),
    ];
    mockDatabaseRows = [
      {
        invoice_date: '2026-07-03',
        invoice_number: 'PART-1',
        invoice_no: 'PART-1',
        branch: rows[0].branch,
        net_amount: 100,
        amount: 100,
      },
    ];

    const summary = await importInvoicesToDB(rows, 'ÙØ±Ø¹ Ø´ÙƒØ±ÙŠ', 'partial-day-batch');

    expect(summary.dayDatabaseComparison?.[0]).toMatchObject({
      date: '2026-07-03',
      status: 'partial',
      fileCount: 2,
      databaseCount: 1,
      countDifference: 1,
    });
  });
});
