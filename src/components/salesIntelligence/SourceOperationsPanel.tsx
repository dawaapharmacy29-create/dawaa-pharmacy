import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isOperatingBranch, OPERATING_BRANCHES } from '@/lib/branch';
import { formatDateTime } from '@/lib/utils';
import { readStaffDirectory, type StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';
import {
  buildSourceCorrectionPreview,
  describeOperationError,
  eligibleCorrectionStaff,
  type SourceCorrectionPreview,
  type StoredSourceAttribution,
} from '@/lib/salesIntelligence/operations/sourceCorrectionModel';
import {
  approveCustomerRequestProposal,
  executeOperationalAction,
  loadSourceAttributionSummary,
  loadSourceAuditPage,
  loadSourceOperationalActions,
  loadStoredSourceAttribution,
  submitSourceAttributionCorrection,
  type SourceAttributionSummary,
  type SourceAuditEntry,
  type SourceOperationalAction,
} from '@/lib/salesIntelligence/operations/sourceOperationsService';
import { customerRequestApprovalBlockers, legacyComplaintReviewReason } from '@/lib/salesIntelligence/operations/proposalApprovalReadiness';

// Source-scoped operations for one canonical case: audited attribution correction, explicit
// approval of a customer-request proposal, and explicit execution through the authorized
// materializer. Every action needs a human click plus confirmation; nothing runs automatically.
// UI permission checks mirror the database commands, which remain the enforcing boundary.
//
// Opening the page costs two bounded reads (source summary + this source's proposals). The
// conversation text and staff directory load only when correction is opened; the audit log loads
// only when expanded, one page at a time.

const EXECUTABLE_TYPES = new Set(['customer_request', 'customer_followup', 'complaint_followup', 'recommendation_followup']);
const TYPE_LABELS: Record<string, string> = {
  customer_request: 'طلب توفير صنف',
  customer_followup: 'متابعة عميل',
  complaint_followup: 'متابعة شكوى',
  recommendation_followup: 'متابعة توصية',
  manual_review: 'مراجعة يدوية',
};
const STATUS_LABELS: Record<string, string> = {
  proposed: 'مقترح — يحتاج اعتماد',
  ready: 'جاهز للتنفيذ',
  created: 'تم التنفيذ',
  dismissed: 'مسحوب/مرفوض',
  error: 'خطأ',
};
// Internal values never reach the reviewer: an unmapped type/status/event reads as Arabic.
const typeLabel = (value: string) => TYPE_LABELS[value] || 'إجراء آخر — يحتاج مراجعة';
const statusLabel = (value: string) => STATUS_LABELS[value] || 'حالة غير معروفة — يحتاج مراجعة';
const AUDIT_LABELS: Record<string, string> = {
  source_attribution_corrected_v1: 'تصحيح نسبة المصدر',
  customer_request_action_approved_v2: 'اعتماد طلب عميل',
  operational_action_materialized: 'تنفيذ إجراء',
  analysis_created: 'إنشاء تحليل',
  analysis_reanalyzed: 'إعادة تحليل',
  automatic_review_created: 'إنشاء تقييم آلي',
  invoice_verification: 'فحص الفاتورة',
  canonical_sale_proof_reconciled_v44: 'مطابقة إثبات البيع',
  legacy_recovery_auto_close_reopened_v40: 'إعادة فتح استرجاع قديم',
};

export interface SourceOperationsPermissions {
  canCorrect: boolean;
  canApprove: boolean;
  canExecute: boolean;
}

interface Props {
  sourceId: string;
  permissions: SourceOperationsPermissions;
  /** Changes whenever the page reloads a new current analysis. */
  analysisKey: string;
}

type Load<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T };

function RetryAlert({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="dawaa-alert dawaa-alert--danger flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>{text}</span>
      <button type="button" className="dawaa-button dawaa-button--secondary" onClick={onRetry}>إعادة المحاولة</button>
    </div>
  );
}

export function SourceOperationsPanel({ sourceId, permissions, analysisKey }: Props) {
  const [summary, setSummary] = useState<Load<SourceAttributionSummary>>({ status: 'loading' });
  const [actions, setActions] = useState<Load<SourceOperationalAction[]>>({ status: 'loading' });
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [auditKey, setAuditKey] = useState(0);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setSummary({ status: 'loading' });
    setActions({ status: 'loading' });
    const settle = <T,>(setter: (value: Load<T>) => void, promise: Promise<T>) =>
      promise
        .then((value) => { if (requestRef.current === request) setter({ status: 'ready', value }); })
        .catch((cause) => { if (requestRef.current === request) setter({ status: 'error', message: describeOperationError(cause) }); });
    await Promise.all([
      settle(setSummary, loadSourceAttributionSummary(sourceId)),
      settle(setActions, loadSourceOperationalActions(sourceId)),
    ]);
    setAuditKey((key) => key + 1);
  }, [sourceId]);

  useEffect(() => {
    setMessage(null);
    setCorrectionOpen(false);
    void reload();
    return () => { requestRef.current += 1; };
  }, [reload, analysisKey]);

  const sourceStaffLabel = (staffId: string | null) => {
    if (!staffId) return 'غير محسوم';
    if (summary.status === 'ready' && summary.value.staffId === staffId) return summary.value.staffName || staffId;
    return `${staffId.slice(0, 8)}… (يختلف عن دكتور المصدر)`;
  };

  async function runAction(action: SourceOperationalAction, kind: 'approve' | 'execute') {
    const details = [
      kind === 'approve' ? 'اعتماد تسجيل هذا الطلب؟' : 'تنفيذ هذا الإجراء وإنشاء السجل التشغيلي؟',
      `النوع: ${typeLabel(action.actionType)}`,
      `العميل: ${action.customerName || 'غير متاح'}`,
      `الدكتور المسؤول: ${sourceStaffLabel(action.staffId)}`,
      `الفرع: ${action.branch || 'غير محدد'}`,
      `الصنف: ${action.productName || '—'} ${action.productCode ? `(${action.productCode})` : ''}`,
      `الكمية: ${action.quantity ?? '—'}`,
      'لن يُسجَّل بيع أو فاتورة أو دفع.',
    ].join('\n');
    if (!window.confirm(details)) return;
    setBusyActionId(action.id);
    setMessage(null);
    try {
      if (kind === 'approve') {
        const result = await approveCustomerRequestProposal(action.id);
        setMessage({ tone: 'success', text: result.alreadyApproved ? 'الطلب كان معتمدًا بالفعل.' : 'تم اعتماد الطلب. التنفيذ خطوة منفصلة.' });
      } else {
        const result = await executeOperationalAction(action.id);
        setMessage({
          tone: 'success',
          text: result.alreadyCreated
            ? `الإجراء كان منفذًا بالفعل؛ السجل المرتبط: ${result.targetId}`
            : `تم التنفيذ وإنشاء السجل المرتبط: ${result.targetId}`,
        });
      }
    } catch (cause) {
      setMessage({ tone: 'danger', text: describeOperationError(cause) });
    } finally {
      setBusyActionId(null);
      await reload();
    }
  }

  return (
    <section className="dawaa-card space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="dawaa-heading text-base font-black">العمليات المقترحة من هذه المحادثة</h2>
        {permissions.canCorrect && summary.status === 'ready' ? (
          <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => setCorrectionOpen((open) => !open)}>
            {correctionOpen ? 'إغلاق تصحيح المصدر' : 'تصحيح الدكتور/الفرع/النص'}
          </button>
        ) : null}
      </div>
      <div className="dawaa-muted text-xs leading-6">
        الاقتراحات لا تُنفذ تلقائيًا. الاعتماد والتنفيذ خطوتان منفصلتان وتتحقق قاعدة البيانات من الهوية والفرع والتحليل الحالي في كل خطوة.
      </div>
      {message ? <div className={`dawaa-alert dawaa-alert--${message.tone} text-sm`} role="status">{message.text}</div> : null}

      {summary.status === 'loading' ? <div className="dawaa-muted text-sm">جاري قراءة المصدر...</div> : null}
      {summary.status === 'error' ? <RetryAlert text={`تعذر قراءة المصدر: ${summary.message}`} onRetry={() => void reload()} /> : null}
      {summary.status === 'ready' ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Info label="العميل" value={`${summary.value.customerName || 'غير متاح'}${summary.value.customerCode ? ` — كود ${summary.value.customerCode}` : ''}`} />
          <Info label="الدكتور المسؤول على المصدر" value={summary.value.staffId ? summary.value.staffName || summary.value.staffId : 'غير محسوم'} />
          <Info
            label="فرع المعاملة على المصدر"
            value={
              <span className={isOperatingBranch(summary.value.branch) ? '' : 'dawaa-badge dawaa-badge--warning'}>
                {summary.value.branch || 'غير محدد'}
              </span>
            }
          />
        </div>
      ) : null}

      {correctionOpen && summary.status === 'ready' ? (
        <SourceCorrectionForm
          sourceId={sourceId}
          onDone={async (text) => {
            setCorrectionOpen(false);
            await reload();
            setMessage({ tone: 'success', text });
          }}
        />
      ) : null}

      {actions.status === 'loading' ? <div className="dawaa-muted text-sm">جاري تحميل الاقتراحات...</div> : null}
      {actions.status === 'error' ? <RetryAlert text={`تعذر تحميل الاقتراحات: ${actions.message}`} onRetry={() => void reload()} /> : null}
      {actions.status === 'ready' && actions.value.length === 0 ? <div className="dawaa-empty-state text-sm">لا توجد اقتراحات تشغيلية لهذه المحادثة.</div> : null}
      {actions.status === 'ready' && actions.value.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="dawaa-muted text-xs">
                <th className="p-2 text-start">النوع</th>
                <th className="p-2 text-start">الحالة</th>
                <th className="p-2 text-start">الفرع</th>
                <th className="p-2 text-start">الدكتور</th>
                <th className="p-2 text-start">الصنف / الكمية</th>
                <th className="p-2 text-start">السجل المرتبط</th>
                <th className="p-2 text-start">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {actions.value.map((action) => {
                const invalidBranch = !isOperatingBranch(action.branch);
                const retired = action.status === 'dismissed';
                const approvalBlockers = action.actionType === 'customer_request' && action.status === 'proposed'
                  ? customerRequestApprovalBlockers(action, summary.status === 'ready' ? summary.value : null)
                  : [];
                const canApproveRow = permissions.canApprove && action.actionType === 'customer_request'
                  && action.status === 'proposed' && approvalBlockers.length === 0;
                const legacyReview = action.targetId ? null : legacyComplaintReviewReason(action);
                const canExecuteRow = permissions.canExecute && EXECUTABLE_TYPES.has(action.actionType)
                  && action.status === 'ready' && !action.targetId && !invalidBranch && !legacyReview
                  && (action.actionType !== 'customer_request' || action.autoEligible);
                return (
                  <tr key={action.id} className={`border-t border-[var(--dawaa-theme-border)] ${retired ? 'opacity-60' : ''}`}>
                    <td className="p-2">{typeLabel(action.actionType)}</td>
                    <td className="p-2">
                      {statusLabel(action.status)}
                      {action.withdrawalReason === 'source_attribution_corrected' ? <div className="dawaa-muted text-xs">سُحب بعد تصحيح المصدر</div> : null}
                      {action.approvedByName && action.status === 'ready' ? <div className="dawaa-muted text-xs">اعتمده: {action.approvedByName}</div> : null}
                    </td>
                    <td className="p-2">
                      <span className={invalidBranch && !retired ? 'dawaa-badge dawaa-badge--warning' : ''}>{action.branch || 'غير محدد'}</span>
                    </td>
                    <td className="p-2">{action.actionType === 'customer_request' ? sourceStaffLabel(action.staffId) : '—'}</td>
                    <td className="p-2">{action.productName || '—'}{action.quantity != null ? ` × ${action.quantity}` : ''}</td>
                    <td className="p-2 font-mono text-xs">{action.targetId ? `${action.targetTable}: ${action.targetId}` : '—'}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-2">
                        {canApproveRow ? (
                          <button type="button" className="dawaa-button dawaa-button--secondary" disabled={busyActionId !== null}
                            onClick={() => void runAction(action, 'approve')}>
                            {busyActionId === action.id ? 'جارٍ...' : 'اعتماد الطلب'}
                          </button>
                        ) : null}
                        {canExecuteRow ? (
                          <button type="button" className="dawaa-button dawaa-button--primary" disabled={busyActionId !== null}
                            onClick={() => void runAction(action, 'execute')}>
                            {busyActionId === action.id ? 'جارٍ...' : 'تنفيذ'}
                          </button>
                        ) : null}
                        {approvalBlockers.length ? (
                          <div className="text-xs">
                            <div className="dawaa-heading font-bold">غير قابل للاعتماد:</div>
                            <ul className="dawaa-muted list-inside list-disc">
                              {approvalBlockers.map((reason) => <li key={reason}>{reason}</li>)}
                            </ul>
                          </div>
                        ) : !retired && invalidBranch ? <span className="dawaa-muted text-xs">يحتاج تصحيح الفرع أولًا</span> : null}
                        {legacyReview ? <span className="dawaa-badge dawaa-badge--warning text-xs" data-testid="legacy-complaint-review">{legacyReview}</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <SourceAuditLog key={`${sourceId}:${auditKey}`} sourceId={sourceId} />
    </section>
  );
}

function SourceAuditLog({ sourceId }: { sourceId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<SourceAuditEntry[]>([]);
  const [state, setState] = useState<Load<{ hasOlder: boolean }>>({ status: 'idle' });

  const loadPage = useCallback(async (before: string | null) => {
    setState({ status: 'loading' });
    try {
      const page = await loadSourceAuditPage(sourceId, before);
      setEntries((current) => (before ? [...current, ...page.entries] : page.entries));
      setState({ status: 'ready', value: { hasOlder: page.hasOlder } });
    } catch (cause) {
      setState({ status: 'error', message: describeOperationError(cause) });
    }
  }, [sourceId]);

  const oldest = entries.length ? entries[entries.length - 1].createdAt : null;
  return (
    <details
      className="space-y-2"
      onToggle={(event) => {
        const isOpen = (event.currentTarget as HTMLDetailsElement).open;
        setOpen(isOpen);
        if (isOpen && state.status === 'idle') void loadPage(null);
      }}
    >
      <summary className="dawaa-heading cursor-pointer text-sm font-bold">سجل المراجعة لهذا المصدر</summary>
      {open && state.status === 'error' ? (
        <RetryAlert text={`تعذر تحميل السجل: ${state.message}`} onRetry={() => void loadPage(entries.length ? oldest : null)} />
      ) : null}
      {open && state.status === 'ready' && !entries.length ? <div className="dawaa-muted text-sm">لا توجد أحداث مسجلة.</div> : null}
      {entries.length ? (
        <ul className="space-y-2 text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3">
              <div className="dawaa-heading font-bold">{AUDIT_LABELS[entry.action] || 'حدث آخر في سجل المصدر'}</div>
              <div className="dawaa-muted text-xs">
                {entry.actorName || 'غير معروف'} — {entry.createdAt ? formatDateTime(entry.createdAt) : 'بدون وقت'}
              </div>
              {entry.note ? <div className="mt-1 text-xs">السبب: {entry.note}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open && state.status === 'loading' ? <div className="dawaa-muted text-sm">جاري التحميل...</div> : null}
      {open && state.status === 'ready' && state.value.hasOlder ? (
        <button type="button" className="dawaa-button dawaa-button--ghost" onClick={() => void loadPage(oldest)}>عرض أحداث أقدم</button>
      ) : null}
    </details>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3">
      <div className="dawaa-muted text-xs">{label}</div>
      <div className="dawaa-heading mt-1 text-sm font-bold">{value}</div>
    </div>
  );
}

function SourceCorrectionForm({ sourceId, onDone }: { sourceId: string; onDone: (message: string) => Promise<void> }) {
  const [context, setContext] = useState<Load<{ stored: StoredSourceAttribution; directory: StaffDirectoryIdentity[] }>>({ status: 'loading' });

  const load = useCallback(() => {
    let cancelled = false;
    setContext({ status: 'loading' });
    Promise.all([loadStoredSourceAttribution(sourceId), readStaffDirectory()])
      .then(([stored, directory]) => { if (!cancelled) setContext({ status: 'ready', value: { stored, directory } }); })
      .catch((cause) => { if (!cancelled) setContext({ status: 'error', message: describeOperationError(cause) }); });
    return () => { cancelled = true; };
  }, [sourceId]);

  useEffect(() => load(), [load]);

  if (context.status === 'loading' || context.status === 'idle') {
    return <div className="dawaa-muted text-sm">جاري تحميل نص المحادثة ودليل الموظفين...</div>;
  }
  if (context.status === 'error') {
    return <RetryAlert text={`تعذر تجهيز التصحيح: ${context.message}`} onRetry={() => load()} />;
  }
  return <SourceCorrectionEditor stored={context.value.stored} directory={context.value.directory} onDone={onDone} />;
}

function SourceCorrectionEditor({
  stored,
  directory,
  onDone,
}: {
  stored: StoredSourceAttribution;
  directory: StaffDirectoryIdentity[];
  onDone: (message: string) => Promise<void>;
}) {
  const [rawText, setRawText] = useState(stored.rawText);
  const [branch, setBranch] = useState(isOperatingBranch(stored.branch) ? String(stored.branch) : '');
  const [staffId, setStaffId] = useState<string>('');
  const [crossBranchCover, setCrossBranchCover] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<SourceCorrectionPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staffOptions = useMemo(
    () => (branch ? eligibleCorrectionStaff(directory, branch, stored.customerId) : []),
    [branch, directory, stored.customerId]
  );
  const selected = staffOptions.find((row) => row.id === staffId) ?? null;

  // Any edit invalidates the reviewed preview and its confirmation.
  const edit = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPreview(null);
    setConfirmed(false);
    setError(null);
  };

  async function review() {
    setError(null);
    setPreview(await buildSourceCorrectionPreview(stored, { rawText, staffId: staffId || null, branch, reason, crossBranchCover }, directory));
  }

  async function submit() {
    if (!preview || !('rawText' in preview) || !confirmed || submitting) return;
    const summary = [
      'اعتماد تصحيح المصدر؟',
      ...preview.changes.map((change) => `${change.label}: ${change.before} ← ${change.after}`),
      'سيتم سحب الاقتراحات غير المنفذة لهذا المصدر دون حذفها، وتسجيل التصحيح في سجل المراجعة.',
      'بعدها يلزم الضغط على «إعادة التحليل الصريحة».',
    ].join('\n');
    if (!window.confirm(summary)) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitSourceAttributionCorrection(stored, preview);
      await onDone(result.changed
        ? `تم تصحيح المصدر وتسجيله في سجل المراجعة، وسُحب ${result.retiredActions} اقتراح غير منفذ. اضغط «إعادة التحليل الصريحة» الآن.`
        : 'التصحيح نفسه كان مطبقًا بالفعل؛ لم يتغير شيء.');
    } catch (cause) {
      setError(describeOperationError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3">
      <div className="dawaa-heading text-sm font-black">تصحيح نسبة المصدر</div>
      <div className="dawaa-muted text-xs leading-6">
        التصحيح لا يغير هوية العميل ولا يحذف أي دليل. يُرفض تلقائيًا إذا كان على المصدر إجراء معتمد أو منفذ أو تأكيد بشري.
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="dawaa-muted text-xs">فرع المعاملة الفعلي (الحالي: {stored.branch || 'غير محدد'})</span>
          <select className="dawaa-input w-full" value={branch} onChange={(event) => { edit(setBranch)(event.target.value); setStaffId(''); setCrossBranchCover(false); }}>
            <option value="">اختر فرع التشغيل</option>
            {OPERATING_BRANCHES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="dawaa-muted text-xs">الدكتور المسؤول (الحالي: {stored.staffName || 'غير محسوم'})</span>
          <select className="dawaa-input w-full" value={staffId} disabled={!branch}
            onChange={(event) => { edit(setStaffId)(event.target.value); setCrossBranchCover(false); }}>
            <option value="">اختر من دليل الموظفين</option>
            {staffOptions.map((row) => (
              <option key={String(row.id)} value={String(row.id)}>
                {row.name} — فرعه الأساسي: {row.branch || 'بدون فرع'}
                {row.coverage === 'cross_branch' ? ' (تغطية فرع آخر)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selected?.coverage === 'cross_branch' ? (
        <label className="dawaa-alert dawaa-alert--warning flex items-start gap-2 text-sm">
          <input type="checkbox" checked={crossBranchCover} onChange={(event) => edit(setCrossBranchCover)(event.target.checked)} />
          <span>أؤكد أن {selected.name} (فرعه الأساسي {selected.branch || 'غير محدد'}) غطّى {branch} في هذه العملية تحديدًا. يُسجل هذا التأكيد في سجل المراجعة.</span>
        </label>
      ) : null}
      <label className="block space-y-1 text-sm">
        <span className="dawaa-muted text-xs">نص المحادثة المصحح (نفس التوقيتات وعدد الرسائل)</span>
        <textarea className="dawaa-input min-h-[180px] w-full font-mono text-xs" dir="auto" value={rawText}
          onChange={(event) => edit(setRawText)(event.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="dawaa-muted text-xs">سبب التصحيح (يُحفظ في سجل المراجعة)</span>
        <input className="dawaa-input w-full" value={reason} onChange={(event) => edit(setReason)(event.target.value)} />
      </label>
      <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => void review()}>
        معاينة التغييرات
      </button>

      {preview && 'errors' in preview ? (
        <ul className="dawaa-alert dawaa-alert--warning list-inside list-disc text-sm">
          {preview.errors.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
      {preview && 'rawText' in preview ? (
        <div className="space-y-3">
          <table className="w-full text-sm">
            <thead><tr className="dawaa-muted text-xs"><th className="p-2 text-start">الحقل</th><th className="p-2 text-start">قبل</th><th className="p-2 text-start">بعد</th></tr></thead>
            <tbody>
              {preview.changes.map((change) => (
                <tr key={change.field} className="border-t border-[var(--dawaa-theme-border)]">
                  <td className="p-2 font-bold">{change.label}</td>
                  <td className="p-2 line-through opacity-70">{change.before}</td>
                  <td className="p-2">{change.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.changedLines.length ? (
            <div className="space-y-2">
              {preview.changedLines.map((line) => (
                <div key={line.line} className="rounded-xl bg-[var(--dawaa-theme-soft)] p-2 font-mono text-xs" dir="auto">
                  <div className="dawaa-muted">سطر {line.line}</div>
                  <div className="line-through opacity-70">{line.before || '—'}</div>
                  <div>{line.after || '—'}</div>
                </div>
              ))}
            </div>
          ) : null}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>راجعت البيانات القديمة والجديدة، وأؤكد أن الدكتور والفرع صحيحان، وأفهم أن الاقتراحات غير المنفذة ستُسحب وأن إعادة التحليل مطلوبة بعد التصحيح.</span>
          </label>
          <button type="button" className="dawaa-button dawaa-button--primary" disabled={!confirmed || submitting} onClick={() => void submit()}>
            {submitting ? 'جارٍ الحفظ...' : 'اعتماد التصحيح'}
          </button>
        </div>
      ) : null}
      {error ? <div className="dawaa-alert dawaa-alert--danger text-sm">{error}</div> : null}
    </div>
  );
}
