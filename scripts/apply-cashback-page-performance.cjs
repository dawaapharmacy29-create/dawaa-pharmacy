const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src/pages/CustomerCashback.tsx');
let source = fs.readFileSync(target, 'utf8');
const marker = '// CASHBACK_PAGE_PERFORMANCE_V1';

if (source.includes(marker)) {
  console.log('[cashback-page-performance] already applied');
  process.exit(0);
}

const stateAnchor = `  const [applyingImport, setApplyingImport] = useState(false);`;
if (!source.includes(stateAnchor)) {
  console.error('[cashback-page-performance] state anchor not found');
  process.exit(1);
}
source = source.replace(
  stateAnchor,
  `${stateAnchor}\n  ${marker}\n  const [page, setPage] = useState(1);\n  const [pageSize, setPageSize] = useState(50);\n  const busyRowsRef = useRef<Set<string>>(new Set());`
);

const filteredAnchor = `  const totals = filtered.reduce(`;
if (!source.includes(filteredAnchor)) {
  console.error('[cashback-page-performance] filtered anchor not found');
  process.exit(1);
}
source = source.replace(
  filteredAnchor,
  `  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));\n\n  useEffect(() => {\n    setPage(1);\n  }, [branch, cycleEnd, cycleStart, pageSize, quickFilter, responsibleFilter, search, status]);\n\n  useEffect(() => {\n    if (page > totalPages) setPage(totalPages);\n  }, [page, totalPages]);\n\n  const pageRows = useMemo(() => {\n    const start = (page - 1) * pageSize;\n    return filtered.slice(start, start + pageSize);\n  }, [filtered, page, pageSize]);\n\n${filteredAnchor}`
);

source = source.replace(/filtered\.map\(\(row\) => \{/g, 'pageRows.map((row) => {');

const optimisticOld = `  const updateRow = async (\n    row: CashbackRow,\n    patch: Partial<CashbackRow>,\n    eventType: string,\n    amount?: number,\n    notes?: string\n  ): Promise<void> => {\n    const nextPatch = { ...patch, notes: patch.notes ?? row.notes };\n\n    // Optimistic update: reflect the action immediately in the UI. This is\n    // especially important for the pending filter, where a settled customer\n    // should disappear without waiting for thousands of rows to reload.\n    patchLocalRow(row.id, nextPatch);\n\n    const { error } = await supabase\n      .from('customer_cashback_cycles')\n      .update({ ...nextPatch, updated_at: new Date().toISOString() })\n      .eq('id', row.id);\n\n    if (error) {\n      // Restore the original row if Supabase rejects the update.\n      patchLocalRow(row.id, row);\n      toast.error(error.message);\n      return;\n    }\n\n    // Event history must not delay the visible settlement response.\n    void logCashbackEvent(row, eventType, amount, notes).catch((eventError) => {\n      console.error('Failed to log cashback event', eventError);\n    });\n    toast.success('تم تحديث حالة الكاش باك');\n  };`;

const optimisticNew = `  const updateRow = async (\n    row: CashbackRow,\n    patch: Partial<CashbackRow>,\n    eventType: string,\n    amount?: number,\n    notes?: string\n  ): Promise<void> => {\n    if (busyRowsRef.current.has(row.id)) return;\n    busyRowsRef.current.add(row.id);\n    const nextPatch = { ...patch, notes: patch.notes ?? row.notes };\n\n    // تحديث فوري للواجهة بدون إعادة تحميل آلاف العملاء.\n    patchLocalRow(row.id, nextPatch);\n\n    try {\n      const { error } = await supabase\n        .from('customer_cashback_cycles')\n        .update({ ...nextPatch, updated_at: new Date().toISOString() })\n        .eq('id', row.id);\n\n      if (error) {\n        patchLocalRow(row.id, row);\n        toast.error(error.message);\n        return;\n      }\n\n      void logCashbackEvent(row, eventType, amount, notes).catch((eventError) => {\n        console.error('Failed to log cashback event', eventError);\n      });\n      toast.success('تم تحديث حالة الكاش باك');\n    } finally {\n      busyRowsRef.current.delete(row.id);\n    }\n  };`;

if (source.includes(optimisticOld)) {
  source = source.replace(optimisticOld, optimisticNew);
}

const sectionEnd = `        </div>\n      </section>\n\n      {selected ? (`;
const sectionEndIndex = source.lastIndexOf(sectionEnd);
if (sectionEndIndex === -1) {
  console.error('[cashback-page-performance] table section end not found');
  process.exit(1);
}
const pager = `        </div>\n\n        {!loading && filtered.length ? (\n          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">\n            <div className="text-xs font-bold text-[var(--theme-muted)]">\n              عرض {((page - 1) * pageSize + 1).toLocaleString('ar-EG')}–{Math.min(page * pageSize, filtered.length).toLocaleString('ar-EG')} من {filtered.length.toLocaleString('ar-EG')} عميل\n            </div>\n            <div className="flex flex-wrap items-center gap-2">\n              <select\n                className="dawaa-input h-9 w-28 py-1 text-xs"\n                value={pageSize}\n                onChange={(e) => setPageSize(Number(e.target.value))}\n                aria-label="عدد العملاء في الصفحة"\n              >\n                <option value={25}>25 عميل</option>\n                <option value={50}>50 عميل</option>\n                <option value={100}>100 عميل</option>\n              </select>\n              <button\n                type="button"\n                className="btn-secondary text-xs"\n                onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}\n                disabled={page <= 1}\n              >\n                السابق\n              </button>\n              <span className="min-w-24 text-center text-xs font-black text-[var(--theme-heading)]">\n                صفحة {page.toLocaleString('ar-EG')} من {totalPages.toLocaleString('ar-EG')}\n              </span>\n              <button\n                type="button"\n                className="btn-secondary text-xs"\n                onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}\n                disabled={page >= totalPages}\n              >\n                التالي\n              </button>\n            </div>\n          </div>\n        ) : null}\n      </section>\n\n      {selected ? (`;
source = source.slice(0, sectionEndIndex) + pager + source.slice(sectionEndIndex + sectionEnd.length);

fs.writeFileSync(target, source);
console.log('[cashback-page-performance] applied');
