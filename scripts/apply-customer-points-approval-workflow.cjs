const fs = require('node:fs');
const path = require('node:path');

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    console.warn(`[customer-points-approval-workflow] skipped ${label}: anchor not found`);
    return source;
  }
  return source.replace(before, after);
}

const libPath = path.join(process.cwd(), 'src/lib/customerEngagement.ts');
let lib = fs.readFileSync(libPath, 'utf8');

lib = replaceOnce(
  lib,
  `export type CustomerInvoicePeriodSummary = {
  purchase_total: number;
  invoice_count: number;
  period_start: string;
  period_end: string;
};`,
  `export type CustomerInvoicePeriodSummary = {
  purchase_total: number;
  invoice_count: number;
  period_start: string;
  period_end: string;
};

export type CustomerPointsApprovalRequest = CustomerIdentity & {
  id: string;
  setting_id: string;
  period_start: string;
  period_end: string;
  calculation_mode: 'automatic' | 'manual';
  purchase_total: number;
  invoice_count: number | null;
  reward_rate: number;
  points_amount: number;
  cycle_key: string;
  status: 'pending' | 'approved' | 'rejected' | 'returned';
  request_notes: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  ledger_id: string | null;
};`,
  'approval request type',
);

lib = replaceOnce(
  lib,
  `export async function calculateCustomerLoyaltyCycle(input: {`,
  `export async function fetchCustomerPointsApprovalRequests(identity: CustomerIdentity, status?: CustomerPointsApprovalRequest['status']) {
  const filter = customerOrFilter(identity);
  if (!filter) return [];
  let query = supabase
    .from('customer_points_approval_requests')
    .select('*')
    .or(filter)
    .order('requested_at', { ascending: false })
    .limit(100);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(error.message || 'تعذر تحميل طلبات اعتماد النقاط.');
  return (data || []) as CustomerPointsApprovalRequest[];
}

export async function submitCustomerLoyaltyApproval(input: {
  settingId: string;
  periodStart: string;
  periodEnd: string;
  manualPurchaseTotal?: number | null;
  requestNotes?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}) {
  const { data, error } = await supabase.rpc('submit_customer_loyalty_approval', {
    p_setting_id: input.settingId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_manual_purchase_total: input.manualPurchaseTotal ?? null,
    p_request_notes: input.requestNotes || null,
    p_actor_id: input.actorId || null,
    p_actor_name: input.actorName || null,
  });
  if (error) throw new Error(error.message || 'تعذر إرسال طلب اعتماد النقاط.');
  return data as CustomerPointsApprovalRequest;
}

export async function reviewCustomerLoyaltyApproval(input: {
  requestId: string;
  decision: 'approved' | 'rejected' | 'returned';
  reviewNotes?: string | null;
  actorId?: string | null;
}) {
  const { data, error } = await supabase.rpc('review_customer_loyalty_approval', {
    p_request_id: input.requestId,
    p_decision: input.decision,
    p_review_notes: input.reviewNotes || null,
    p_actor_id: input.actorId || null,
  });
  if (error) throw new Error(error.message || 'تعذر حفظ قرار اعتماد النقاط.');
  return data as CustomerPointsApprovalRequest;
}

export async function calculateCustomerLoyaltyCycle(input: {`,
  'approval functions',
);

fs.writeFileSync(libPath, lib, 'utf8');

const pagePath = path.join(process.cwd(), 'src/pages/CustomerPointsLedger.tsx');
let page = fs.readFileSync(pagePath, 'utf8');

page = replaceOnce(page, `  calculateCustomerLoyaltyCycle,`, `  fetchCustomerPointsApprovalRequests,`, 'replace calculate import');
page = replaceOnce(page, `  runDueCustomerLoyaltyCycles,`, `  reviewCustomerLoyaltyApproval,\n  runDueCustomerLoyaltyCycles,\n  submitCustomerLoyaltyApproval,`, 'approval imports');
page = replaceOnce(page, `  type CustomerPointsLedgerRow,`, `  type CustomerPointsApprovalRequest,\n  type CustomerPointsLedgerRow,`, 'approval type import');

page = replaceOnce(
  page,
  `  const [rows, setRows] = useState<CustomerPointsLedgerRow[]>([]);`,
  `  const [rows, setRows] = useState<CustomerPointsLedgerRow[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<CustomerPointsApprovalRequest[]>([]);
  const [approvalNote, setApprovalNote] = useState('');`,
  'approval state',
);

page = replaceOnce(
  page,
  `      const [ledger, loyaltySetting] = await Promise.all([
        fetchCustomerPointsLedger(identity),
        fetchCustomerLoyaltySetting(identity).catch(() => null),
      ]);
      setRows(ledger);`,
  `      const [ledger, loyaltySetting, approvals] = await Promise.all([
        fetchCustomerPointsLedger(identity),
        fetchCustomerLoyaltySetting(identity).catch(() => null),
        fetchCustomerPointsApprovalRequests(identity).catch(() => []),
      ]);
      setRows(ledger);
      setApprovalRequests(approvals);`,
  'load approvals',
);

page = replaceOnce(
  page,
  `        setRows([]); setSetting(null); setPreview(null);`,
  `        setRows([]); setSetting(null); setPreview(null); setApprovalRequests([]);`,
  'clear approvals',
);

page = replaceOnce(
  page,
  `      const saved = await calculateCustomerLoyaltyCycle({
        settingId: setting.id, periodStart, periodEnd,
        manualPurchaseTotal: mode === 'manual' ? Number(manualTotal) : null,
        actorId: user?.id || null, actorName: user?.name || null,
      });
      setRows((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      setManualTotal('');
      const refreshed = await fetchCustomerLoyaltySetting(customer);
      applySetting(refreshed);
      toast.success(\`تم احتساب \${formatCurrency(saved.points_amount)} نقاط/رصيد للعميل\`);`,
  `      const request = await submitCustomerLoyaltyApproval({
        settingId: setting.id, periodStart, periodEnd,
        manualPurchaseTotal: mode === 'manual' ? Number(manualTotal) : null,
        requestNotes: approvalNote || null,
        actorId: user?.id || null, actorName: user?.name || null,
      });
      setApprovalRequests((current) => [request, ...current.filter((row) => row.id !== request.id)]);
      setManualTotal('');
      setApprovalNote('');
      toast.success(\`تم إرسال استحقاق \${formatCurrency(request.points_amount)} لاعتماد مسؤولة الفرع\`);`,
  'submit instead of direct credit',
);

page = replaceOnce(
  page,
  `  const runAutomaticDue = async () => {`,
  `  const reviewApproval = async (request: CustomerPointsApprovalRequest, decision: 'approved' | 'rejected' | 'returned') => {
    if (decision !== 'approved' && approvalNote.trim().length < 3) return toast.error('اكتب سبب الرفض أو الإعادة');
    setSaving(true);
    try {
      const updated = await reviewCustomerLoyaltyApproval({ requestId: request.id, decision, reviewNotes: approvalNote || null, actorId: user?.id || null });
      setApprovalRequests((current) => current.map((row) => row.id === updated.id ? updated : row));
      setApprovalNote('');
      await loadCustomerData(customer);
      toast.success(decision === 'approved' ? 'تم اعتماد النقاط وإضافتها لرصيد العميل' : decision === 'returned' ? 'تمت إعادة الطلب للمراجعة' : 'تم رفض طلب النقاط');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر حفظ قرار الاعتماد'); }
    finally { setSaving(false); }
  };

  const runAutomaticDue = async () => {`,
  'review function',
);

page = replaceOnce(
  page,
  `<button className="btn-primary w-full" onClick={() => void calculateCycle()} disabled={saving || !setting}><Gift className="ml-1 inline h-4 w-4"/> اعتماد واحتساب هذه الدورة</button>`,
  `<textarea className="input-dark w-full" rows={2} placeholder="ملاحظة طلب الاعتماد – اختيارية" value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)}/>
      <button className="btn-primary w-full" onClick={() => void calculateCycle()} disabled={saving || !setting}><Gift className="ml-1 inline h-4 w-4"/> إرسال الدورة لاعتماد مسؤولة الفرع</button>`,
  'submit button label',
);

page = replaceOnce(
  page,
  `    <section className="space-y-3">
      <div className="flex items-center gap-2 text-lg font-black text-white"><History className="text-cyan-300"/> التاريخ الكامل لنقاط العميل</div>`,
  `    <section className="dawaa-panel space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-lg font-black text-white">طلبات اعتماد النقاط</div><span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-200">معلّق: {approvalRequests.filter((row) => row.status === 'pending').length}</span></div>
      {approvalRequests.length === 0 ? <div className="text-sm text-slate-400">لا توجد طلبات اعتماد لهذا العميل.</div> : approvalRequests.slice(0, 10).map((request) => <article key={request.id} className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-white">{formatCurrency(request.points_amount)} عن مشتريات {formatCurrency(request.purchase_total)}</b><span className={request.status === 'approved' ? 'text-emerald-300' : request.status === 'pending' ? 'text-amber-300' : 'text-red-300'}>{request.status === 'approved' ? 'معتمد' : request.status === 'pending' ? 'في انتظار الاعتماد' : request.status === 'returned' ? 'معاد للمراجعة' : 'مرفوض'}</span></div>
        <div className="mt-2 grid gap-2 text-xs text-slate-300 md:grid-cols-4"><span>الفترة: {formatDate(request.period_start)} — {formatDate(request.period_end)}</span><span>النسبة: {Number(request.reward_rate) * 100}%</span><span>الفواتير: {request.invoice_count ?? 'يدوي'}</span><span>الطالب: {request.requested_by_name || 'النظام'}</span></div>
        {request.status === 'pending' ? <div className="mt-3 grid gap-2 sm:grid-cols-3"><button className="btn-primary" disabled={saving} onClick={() => void reviewApproval(request,'approved')}>اعتماد وإضافة الرصيد</button><button className="btn-secondary" disabled={saving} onClick={() => void reviewApproval(request,'returned')}>إعادة للمراجعة</button><button className="btn-secondary" disabled={saving} onClick={() => void reviewApproval(request,'rejected')}>رفض</button></div> : null}
        {request.review_notes ? <div className="mt-2 text-xs text-slate-400">ملاحظة المراجعة: {request.review_notes}</div> : null}
      </article>)}
    </section>

    <section className="space-y-3">
      <div className="flex items-center gap-2 text-lg font-black text-white"><History className="text-cyan-300"/> التاريخ الكامل لنقاط العميل</div>`,
  'approval UI section',
);

fs.writeFileSync(pagePath, page, 'utf8');
console.log('Customer points approval workflow UI applied.');
