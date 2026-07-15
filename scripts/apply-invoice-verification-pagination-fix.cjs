const fs = require('node:fs');

const importerPath = 'src/lib/invoiceImporter.ts';
const testPath = 'src/lib/__tests__/invoiceImporter.test.ts';

function replaceOnce(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`Could not find ${label}`);
  return source.replace(search, replacement);
}

let importer = fs.readFileSync(importerPath, 'utf8');

importer = replaceOnce(
  importer,
  "  databaseByBranch?: Array<{ branch: string; count: number; total: number }>;\n",
  "  databaseByBranch?: Array<{ branch: string; count: number; total: number }>;\n  verificationComplete?: boolean;\n  verificationFetchedCount?: number;\n  verificationPagesCount?: number;\n  verificationPageSize?: number;\n  verificationError?: string | null;\n",
  'ImportSummary verification fields'
);

importer = replaceOnce(
  importer,
  "    databaseInvoiceKeys: [] as string[],\n    comparison: [] as NonNullable<ImportSummary['dayDatabaseComparison']>,\n",
  "    databaseInvoiceKeys: [] as string[],\n    comparison: [] as NonNullable<ImportSummary['dayDatabaseComparison']>,\n    verificationComplete: false,\n    verificationFetchedCount: 0,\n    verificationPagesCount: 0,\n    verificationPageSize: 500,\n    verificationError: null as string | null,\n",
  'empty verification metadata'
);

const oldQuery = `  const { data, error } = await supabase
    .from('sales_invoices')
    .select(selectColumns)
    .gte('invoice_date', startDate)
    .lt('invoice_date', queryEndExclusive)
    .limit(100000);

  if (error)
    return {
      ...empty,
      databaseComparisonQuery: {
        table: 'sales_invoices',
        dateColumn: 'invoice_date',
        gte: queryStart,
        lt: queryEndExclusive,
        fileMinDate: queryStart,
        fileMaxDate: queryEnd,
        select: selectColumns,
        error: error.message || String(error),
        startDate: queryStart,
        endDate: queryEnd,
        endExclusive: queryEndExclusive,
      },
    };
`;

const newQuery = `  const verificationPageSize = 500;
  const data: Array<Record<string, unknown>> = [];
  let verificationPagesCount = 0;
  let verificationError: string | null = null;

  for (let from = 0; ; from += verificationPageSize) {
    const to = from + verificationPageSize - 1;
    const page = await supabase
      .from('sales_invoices')
      .select(selectColumns)
      .gte('invoice_date', startDate)
      .lt('invoice_date', queryEndExclusive)
      .order('invoice_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    verificationPagesCount += 1;

    if (page.error) {
      verificationError = page.error.message || String(page.error);
      break;
    }

    const pageRows = (page.data || []) as Array<Record<string, unknown>>;
    data.push(...pageRows);
    if (pageRows.length < verificationPageSize) break;
  }

  if (verificationError)
    return {
      ...empty,
      verificationFetchedCount: data.length,
      verificationPagesCount,
      verificationPageSize,
      verificationError,
      databaseComparisonQuery: {
        table: 'sales_invoices',
        dateColumn: 'invoice_date',
        gte: queryStart,
        lt: queryEndExclusive,
        fileMinDate: queryStart,
        fileMaxDate: queryEnd,
        select: selectColumns,
        error: verificationError,
        startDate: queryStart,
        endDate: queryEnd,
        endExclusive: queryEndExclusive,
      },
    };
`;
importer = replaceOnce(importer, oldQuery, newQuery, 'single verification query');

importer = importer.replace(
  "  for (const row of (data || []) as Array<Record<string, unknown>>) {",
  "  for (const row of data) {"
);

importer = replaceOnce(
  importer,
  "    databaseInvoiceKeys: [...databaseInvoiceKeys],\n    databaseComparisonQuery: {",
  "    databaseInvoiceKeys: [...databaseInvoiceKeys],\n    verificationComplete: true,\n    verificationFetchedCount: data.length,\n    verificationPagesCount,\n    verificationPageSize,\n    verificationError: null,\n    databaseComparisonQuery: {",
  'successful verification metadata'
);

importer = replaceOnce(
  importer,
  "  summary.databaseByBranch = databaseComparison.databaseByBranch;\n  summary.dayDatabaseComparison = databaseComparison.comparison;\n  summary.databaseComparisonQuery = databaseComparison.databaseComparisonQuery;\n",
  "  summary.databaseByBranch = databaseComparison.databaseByBranch;\n  summary.dayDatabaseComparison = databaseComparison.comparison;\n  summary.databaseComparisonQuery = databaseComparison.databaseComparisonQuery;\n  summary.verificationComplete = databaseComparison.verificationComplete;\n  summary.verificationFetchedCount = databaseComparison.verificationFetchedCount;\n  summary.verificationPagesCount = databaseComparison.verificationPagesCount;\n  summary.verificationPageSize = databaseComparison.verificationPageSize;\n  summary.verificationError = databaseComparison.verificationError;\n",
  'summary verification metadata assignment'
);

const startMarker = "  const verifiedInvoiceKeys = new Set(databaseComparison.databaseInvoiceKeys || []);\n";
const endMarker = "  summary.conflictsByReason = [...skippedByReason.values()]\n";
const start = importer.indexOf(startMarker);
const end = importer.indexOf(endMarker, start);
if (start === -1 || end === -1) throw new Error('Could not find import verification comparison block');

const guardedBlock = `  if (databaseComparison.verificationComplete === true) {
    const verifiedInvoiceKeys = new Set(databaseComparison.databaseInvoiceKeys || []);
    for (const trace of traceMap.values()) {
      if (!trace.saveSucceeded) continue;
      const verificationKey = invoiceDuplicateKey(trace.invoice_number, trace.branch, trace.parsed_date);
      const postSaveFound = verifiedInvoiceKeys.has(verificationKey);
      markTrace(traceMap, String(trace.rowNumber), {
        postSaveFound,
        postImportStatus: postSaveFound ? 'found_after_verification' : 'saved_but_not_found_after_verification',
        finalStatus: postSaveFound ? trace.finalStatus || 'saved' : 'saved_but_not_found_after_verification',
        skipReason: postSaveFound ? trace.skipReason : trace.skipReason || 'saved_but_not_found_after_verification',
      });
    }
    summary.missingDaysInDatabase = summary.dayDatabaseComparison
      .filter((row) => row.status === 'missing_in_database')
      .map((row) => ({ date: row.date, count: row.fileCount, total: row.fileTotal }));
    const missingDaySet = new Set(summary.missingDaysInDatabase.map((row) => row.date));
    for (const trace of traceMap.values()) {
      if (missingDaySet.has(trace.parsed_date)) {
        const finalStatus = trace.saveSucceeded
          ? 'saved_but_not_found_after_verification'
          : trace.finalStatus || (trace.saveAttempted ? 'supabase_insert_failed' : 'save_not_attempted');
        markTrace(traceMap, String(trace.rowNumber), {
          postImportStatus: 'missing_day_in_database_after_import',
          finalStatus,
          skipReason: trace.skipReason || finalStatus,
        });
      }
    }
    const missingDaySamples = rows
      .filter((row) => missingDaySet.has(row.date))
      .slice(0, 20)
      .map((row) => ({
        invoiceNumber: row.invoiceNumber,
        date: row.date,
        branch: row.branch || branch,
        amount: rawInvoiceNetValue(row),
        reason:
          traceMap.get(traceKey(row))?.finalStatus ||
          traceMap.get(traceKey(row))?.skipReason ||
          'saved_but_not_found_after_verification',
      }));
    summary.missingInvoicesSample = [...conflictRowsSample, ...missingDaySamples].slice(0, 30);
    summary.missingInvoicesCount =
      summary.missingDaysInDatabase.reduce((sum, row) => sum + row.count, 0) +
      conflictRowsSample.length;
  } else {
    summary.dayDatabaseComparison = [];
    summary.missingDaysInDatabase = [];
    summary.missingInvoicesSample = [...conflictRowsSample].slice(0, 30);
    summary.missingInvoicesCount = 0;
    for (const trace of traceMap.values()) {
      if (!trace.saveSucceeded) continue;
      markTrace(traceMap, String(trace.rowNumber), {
        postSaveFound: false,
        postImportStatus: 'verification_incomplete_due_to_query_error',
        finalStatus: 'verification_incomplete_due_to_query_error',
        skipReason: trace.skipReason || 'verification_incomplete_due_to_query_error',
      });
    }
    summary.schemaWarnings?.push(
      'تعذر إكمال قراءة جميع صفحات التحقق من قاعدة البيانات؛ لم يتم تصنيف أي فاتورة كمفقودة.'
    );
  }
`;
importer = importer.slice(0, start) + guardedBlock + importer.slice(end);

fs.writeFileSync(importerPath, importer);

let tests = fs.readFileSync(testPath, 'utf8');

tests = replaceOnce(
  tests,
  "const mockLt = vi.fn();\n",
  "const mockLt = vi.fn();\nconst mockRange = vi.fn();\n",
  'mockRange declaration'
);

tests = replaceOnce(
  tests,
  "let mockDatabaseRows = [];\n",
  "let mockDatabaseRows = [];\nlet mockVerificationErrorPage = -1;\n",
  'verification error page state'
);

tests = replaceOnce(
  tests,
  "  order(_column: string, _options: { ascending: boolean }) {\n    return chain;\n  },\n",
  "  order(_column: string, _options: { ascending: boolean }) {\n    return chain;\n  },\n  range: async (from: number, to: number) => {\n    mockRange(from, to);\n    const pageNumber = Math.floor(from / 500);\n    if (pageNumber === mockVerificationErrorPage) {\n      return { data: null, error: { message: 'verification page failed' } };\n    }\n    return { data: mockDatabaseRows.slice(from, to + 1), error: null };\n  },\n",
  'range mock'
);

tests = replaceOnce(
  tests,
  "  mockLt.mockReset();\n",
  "  mockLt.mockReset();\n  mockRange.mockReset();\n",
  'mockRange reset'
);

tests = replaceOnce(
  tests,
  "  mockDatabaseRows = [];\n  mockExistingInvoiceRows = [];\n",
  "  mockDatabaseRows = [];\n  mockVerificationErrorPage = -1;\n  mockExistingInvoiceRows = [];\n",
  'verification error reset'
);

const paginationTest = `
  it.each([999, 1000, 1001, 1599, 2001])(
    'reads all %i verification rows with 500-row pagination and reports no false missing invoices',
    async (rowCount) => {
      mockDatabaseRows = Array.from({ length: rowCount }, (_, index) => ({
        id: \`db-\${String(index + 1).padStart(6, '0')}\`,
        invoice_date: '2026-07-03',
        invoice_number: \`INV-\${index + 1}\`,
        invoice_no: \`INV-\${index + 1}\`,
        branch: 'فرع شكري',
        net_amount: 1,
      }));
      const fileDays = new Map([
        ['2026-07-03', { date: '2026-07-03', count: rowCount, total: rowCount }],
      ]);

      const result = await loadDatabaseDayComparison(fileDays, '2026-07-03', '2026-07-03');

      expect(result.verificationComplete).toBe(true);
      expect(result.verificationFetchedCount).toBe(rowCount);
      expect(result.verificationPageSize).toBe(500);
      expect(result.verificationPagesCount).toBe(Math.floor(rowCount / 500) + 1);
      expect(result.databaseInvoicesCount).toBe(rowCount);
      expect(result.comparison[0]?.status).toBe('matched');
      expect(result.comparison[0]?.countDifference).toBe(0);
      expect(mockRange).toHaveBeenLastCalledWith(
        Math.floor(rowCount / 500) * 500,
        Math.floor(rowCount / 500) * 500 + 499
      );
    }
  );

  it('marks verification incomplete when any page fails', async () => {
    mockDatabaseRows = Array.from({ length: 1001 }, (_, index) => ({
      id: \`db-\${index + 1}\`,
      invoice_date: '2026-07-03',
      invoice_number: \`INV-\${index + 1}\`,
      branch: 'فرع شكري',
      net_amount: 1,
    }));
    mockVerificationErrorPage = 1;
    const fileDays = new Map([
      ['2026-07-03', { date: '2026-07-03', count: 1001, total: 1001 }],
    ]);

    const result = await loadDatabaseDayComparison(fileDays, '2026-07-03', '2026-07-03');

    expect(result.verificationComplete).toBe(false);
    expect(result.verificationFetchedCount).toBe(500);
    expect(result.verificationPagesCount).toBe(2);
    expect(result.verificationError).toBe('verification page failed');
    expect(result.comparison).toEqual([]);
  });
`;

const describeMarker = "describe('loadDatabaseDayComparison', () => {\n";
if (!tests.includes("reads all %i verification rows")) {
  const markerIndex = tests.indexOf(describeMarker);
  if (markerIndex === -1) throw new Error('Could not find loadDatabaseDayComparison describe block');
  const insertionPoint = tests.indexOf("  it('marks a day as matched", markerIndex);
  tests = tests.slice(0, insertionPoint) + paginationTest + '\n' + tests.slice(insertionPoint);
}

fs.writeFileSync(testPath, tests);
console.log('Applied invoice verification pagination fix.');
