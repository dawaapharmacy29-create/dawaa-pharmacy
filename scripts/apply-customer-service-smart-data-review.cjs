const fs = require('node:fs');
const path = require('node:path');

const file = path.join(process.cwd(), 'src/components/customerService/CustomerFollowupOperationsCompletionPanel.tsx');
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(anchor, replacement, label) {
  if (!source.includes(anchor)) {
    if (source.includes(replacement)) return;
    throw new Error(`Missing patch anchor: ${label}`);
  }
  source = source.replace(anchor, replacement);
}

replaceOnce(
`type AuditRow = {
  id: number;
  followup_id: string;
  customer_id: string | null;
  action: string;
  actor_name: string | null;
  branch: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};
`,
`type AuditRow = {
  id: number;
  followup_id: string;
  customer_id: string | null;
  action: string;
  actor_name: string | null;
  branch: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type DataReviewRow = {
  id: string;
  customer_id: string | null;
  display_customer_name: string | null;
  customer_name: string | null;
  customer_code: string | null;
  display_phone: string | null;
  phone: string | null;
  branch: string | null;
  operational_status: string | null;
  issue_labels: string[];
};
`,
'add data review type'
);

replaceOnce(
`function metric(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
`,
`function metric(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function digits(value?: string | null) {
  return String(value || '').replace(/\\D/g, '');
}

function detectDataIssues(row: Omit<DataReviewRow, 'issue_labels'>) {
  const issues: string[] = [];
  const name = String(row.display_customer_name || row.customer_name || '').trim();
  const code = String(row.customer_code || '').trim();
  const phone = digits(row.display_phone || row.phone);
  const branch = normalizeBranchName(row.branch || '');

  if (!name || name === 'عميل غير مسجل' || /[?]{1,}|\\.\\.\\./.test(name)) issues.push('الاسم يحتاج مراجعة');
  if (!code || ['0', '00', '01'].includes(code)) issues.push('الكود ناقص أو غير صالح');
  if (!phone) issues.push('الهاتف غير موجود');
  else if (phone.length < 10 || phone.length > 12) issues.push('الهاتف غير صالح');
  if (code && phone && digits(code) === phone) issues.push('الهاتف يساوي كود العميل');
  if (!branch || !['فرع الشامي', 'فرع شكري'].includes(branch)) issues.push('الفرع غير مؤكد');
  return issues;
}
`,
'add issue detector'
);

replaceOnce(
`  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
`,
`  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [reviewRows, setReviewRows] = useState<DataReviewRow[]>([]);
  const [reviewSearch, setReviewSearch] = useState('');
`,
'add review state'
);

replaceOnce(
`      const [performanceResult, duplicateResult, auditResult] = await Promise.all([
`,
`      const [performanceResult, duplicateResult, auditResult, reviewResult] = await Promise.all([
`,
'include review query result'
);

replaceOnce(
`        supabase
          .from('customer_followup_audit_log')
          .select('id,followup_id,customer_id,action,actor_name,branch,created_at,metadata')
          .order('created_at', { ascending: false })
          .limit(100),
`,
`        supabase
          .from('customer_followup_audit_log')
          .select('id,followup_id,customer_id,action,actor_name,branch,created_at,metadata')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('customer_followup_operations_v2')
          .select('id,customer_id,display_customer_name,customer_name,customer_code,display_phone,phone,branch,operational_status')
          .in('operational_status', ['open', 'postponed', 'needs_manager'])
          .order('updated_at', { ascending: false })
          .limit(1000),
`,
'query review candidates'
);

replaceOnce(
`      if (auditResult.error) throw auditResult.error;
      setPerformance((performanceResult.data || []) as PerformanceRow[]);
      setDuplicates((duplicateResult.data || []) as DuplicateGroup[]);
      setAuditRows((auditResult.data || []) as AuditRow[]);
`,
`      if (auditResult.error) throw auditResult.error;
      if (reviewResult.error) throw reviewResult.error;
      setPerformance((performanceResult.data || []) as PerformanceRow[]);
      setDuplicates((duplicateResult.data || []) as DuplicateGroup[]);
      setAuditRows((auditResult.data || []) as AuditRow[]);
      const branchFilter = branch === ALL_BRANCHES ? '' : normalizeBranchName(branch);
      const reviewCandidates = ((reviewResult.data || []) as Omit<DataReviewRow, 'issue_labels'>[])
        .map((row) => ({ ...row, branch: normalizeBranchName(row.branch || '') || row.branch, issue_labels: detectDataIssues(row) }))
        .filter((row) => row.issue_labels.length > 0)
        .filter((row) => !branchFilter || normalizeBranchName(row.branch || '') === branchFilter);
      const unique = new Map<string, DataReviewRow>();
      for (const row of reviewCandidates) {
        const key = String(row.customer_code || '').trim() || digits(row.display_phone || row.phone) || String(row.customer_id || row.id);
        if (!unique.has(key)) unique.set(key, row);
      }
      setReviewRows([...unique.values()]);
`,
'populate review rows'
);

replaceOnce(
`  const filteredAudit = useMemo(() => {
`,
`  const filteredReviewRows = useMemo(() => {
    const query = reviewSearch.trim().toLowerCase();
    if (!query) return reviewRows;
    return reviewRows.filter((row) =>
      \`${'${row.display_customer_name || row.customer_name || ""} ${row.customer_code || ""} ${row.display_phone || row.phone || ""} ${row.branch || ""} ${row.issue_labels.join(" ")}'}\`
        .toLowerCase()
        .includes(query)
    );
  }, [reviewRows, reviewSearch]);

  function selectForCorrection(row: DataReviewRow) {
    setCorrection({
      followupId: row.id,
      name: String(row.display_customer_name || row.customer_name || ''),
      code: String(row.customer_code || ''),
      phone: String(row.display_phone || row.phone || ''),
      branch: normalizeBranchName(row.branch || ''),
      note: \`تصحيح من قائمة مراجعة البيانات: ${'${row.issue_labels.join("، ")}'}\`,
    });
  }

  const filteredAudit = useMemo(() => {
`,
'add review filtering and selection'
);

replaceOnce(
`      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
`,
`      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-lg font-black text-white">
              <AlertTriangle size={19} className="text-amber-300" />
              مراجعة البيانات الذكية
            </div>
            <p className="mt-1 text-xs font-bold text-slate-400">اختر العميل بدل كتابة معرف المتابعة يدويًا. القائمة تعرض فقط البيانات التي تحتاج مراجعة.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black text-amber-200">{reviewRows.length} حالة</span>
            <div className="relative"><Search size={15} className="absolute right-3 top-3 text-slate-400" /><input className="input-dark pr-9" placeholder="اسم / كود / هاتف" value={reviewSearch} onChange={(event) => setReviewSearch(event.target.value)} /></div>
          </div>
        </div>
        <div className="grid max-h-96 gap-2 overflow-auto md:grid-cols-2 xl:grid-cols-3">
          {filteredReviewRows.map((row) => (
            <button key={row.id} type="button" onClick={() => selectForCorrection(row)} className={`rounded-xl border p-3 text-right transition ${correction.followupId === row.id ? 'border-cyan-300 bg-cyan-500/10' : 'border-white/10 bg-[#102b46] hover:border-cyan-300/40'}`}>
              <div className="font-black text-white">{row.display_customer_name || row.customer_name || 'عميل غير مسجل'}</div>
              <div className="mt-1 text-xs font-bold text-slate-400">{row.customer_code || 'بدون كود'} · {row.display_phone || row.phone || 'بدون هاتف'} · {row.branch || 'فرع غير محدد'}</div>
              <div className="mt-2 flex flex-wrap gap-1">{row.issue_labels.map((issue) => <span key={issue} className="rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-black text-amber-200">{issue}</span>)}</div>
            </button>
          ))}
          {!loading && filteredReviewRows.length === 0 ? <div className="p-6 text-center font-bold text-emerald-300 md:col-span-2 xl:col-span-3">لا توجد بيانات تحتاج مراجعة في النطاق الحالي</div> : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
`,
'insert smart review list'
);

replaceOnce(
`            <input className="input-dark sm:col-span-2" placeholder="معرف المتابعة" value={correction.followupId} onChange={(event) => setCorrection((current) => ({ ...current, followupId: event.target.value }))} />
`,
`            <div className="input-dark sm:col-span-2 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs">{correction.followupId || 'اختر عميلًا من قائمة مراجعة البيانات بالأعلى'}</span>
              {correction.followupId ? <button type="button" className="text-xs font-black text-cyan-200" onClick={() => setCorrection(EMPTY_CORRECTION)}>مسح</button> : null}
            </div>
`,
'remove manual followup id input'
);

fs.writeFileSync(file, source, 'utf8');
console.log('Applied smart customer data review and selectable correction workflow.');
