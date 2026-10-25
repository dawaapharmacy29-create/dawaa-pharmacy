// General-manager soft delete of one case or of a whole conversation. Opens on a server preview of
// the exact scope; the command re-checks everything in the database (role, blockers, fingerprint).
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  canSubmitDeletion,
  clearUnconfirmedWhatsAppInvoiceCandidate,
  DELETION_CONFIRMATION_PHRASES,
  DELETION_REASON_MIN_LENGTH,
  DELETION_UNTOUCHED_RECORDS,
  deleteWhatsAppScope,
  deletionBlockerLabel,
  deletionErrorMessage,
  newDeletionRequestKey,
  previewWhatsAppDeletion,
  summarizeDeletionPreview,
  type DeletionBlocker,
  type DeletionPreview,
  type WhatsAppDeletionScope,
} from '@/lib/salesIntelligence/operations/whatsappDeletionService';

export function WhatsAppDeletionDialog({
  scope,
  target,
  onClose,
  onDeleted,
}: {
  scope: WhatsAppDeletionScope;
  target: string;
  onClose: () => void;
  onDeleted: (deletionId: string) => void;
}) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<DeletionBlocker[]>([]);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [candidateReason, setCandidateReason] = useState('');
  const [candidateConfirmation, setCandidateConfirmation] = useState('');
  const [correctingCandidate, setCorrectingCandidate] = useState(false);
  const candidateRequestKey = useRef(newDeletionRequestKey());
  // One key for this dialog: a double click or retry replays the same server request.
  const requestKey = useRef(newDeletionRequestKey());
  const phrase = DELETION_CONFIRMATION_PHRASES[scope];

  async function loadPreview() {
    setLoading(true);
    setError(null);
    try {
      const next = await previewWhatsAppDeletion(supabase, scope, target);
      setPreview(next);
      setBlockers(next.blockers);
    } catch (cause) {
      setPreview(null);
      setError(deletionErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPreview();
    // scope/target are fixed for the dialog's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!preview || !canSubmitDeletion({ scope, preview, reason, confirmation, submitting })) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await deleteWhatsAppScope(supabase, {
        scope,
        target,
        reason: reason.trim(),
        confirmation: confirmation.trim(),
        fingerprint: preview.fingerprint,
        requestKey: requestKey.current,
      });
      if (result.kind === 'blocked') {
        setBlockers(result.blockers);
        setPreview({ ...preview, blocked: true, blockers: result.blockers });
        return;
      }
      onDeleted(result.deletionId);
    } catch (cause) {
      setError(deletionErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  const candidate = preview?.conversation;
  const canCorrectCandidate = scope === 'conversation' && preview?.status === 'preview'
    && blockers.length === 1 && blockers[0].code === 'conversation_has_invoice_link'
    && candidate?.matchedInvoiceId && candidate?.matchedInvoiceNumber
    && candidate?.invoiceLinkConfirmed === false && !candidate?.invoiceLinkConfirmedInvoiceNumber
    && preview.attributions.every((a) => !a.invoiceId && a.official !== true && a.level !== 'proven')
    && preview.v22Envelopes.every((e) => e.proofState !== 'proven' && !e.verifiedInvoiceNumber && !e.verifiedRevenue);

  async function correctCandidate() {
    if (!canCorrectCandidate || correctingCandidate || candidateReason.trim().length < 10
      || candidateConfirmation.trim() !== 'تصحيح ربط الفاتورة') return;
    setCorrectingCandidate(true);
    setError(null);
    try {
      await clearUnconfirmedWhatsAppInvoiceCandidate(supabase, {
        sourceId: preview!.sourceId,
        expectedId: String(candidate!.matchedInvoiceId),
        expectedNumber: String(candidate!.matchedInvoiceNumber),
        reason: candidateReason.trim(),
        requestKey: candidateRequestKey.current,
      });
      await loadPreview();
    } catch (cause) {
      setError(deletionErrorMessage(cause));
    } finally {
      setCorrectingCandidate(false);
    }
  }

  const summary = preview && preview.status === 'preview' ? summarizeDeletionPreview(preview) : null;
  const ready = canSubmitDeletion({ scope, preview, reason, confirmation, submitting });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" dir="rtl" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-lg font-black text-[var(--dawaa-theme-heading)]">
            <Trash2 size={18} /> {summary?.title ?? (scope === 'case' ? 'حذف حالة' : 'حذف محادثة')}
          </h3>
          <button type="button" className="dawaa-button dawaa-button--ghost" onClick={onClose} aria-label="إغلاق"><X size={16} /></button>
        </div>

        {loading ? <div className="dawaa-muted py-6 text-center text-sm">جارٍ تجهيز معاينة الحذف...</div> : null}
        {error ? <div className="dawaa-alert dawaa-alert--danger mt-3 text-sm">{error}</div> : null}

        {preview && preview.status !== 'preview' ? (
          <div className="dawaa-alert dawaa-alert--info mt-3 text-sm">
            {preview.status === 'conversation_deleted' ? 'المحادثة كلها محذوفة بالفعل.' : 'هذا النطاق محذوف بالفعل ويمكن استرجاعه من سلة المحذوفات.'}
          </div>
        ) : null}

        {summary ? (
          <div className="mt-3 space-y-3 text-sm">
            <div className={scope === 'conversation' ? 'dawaa-alert dawaa-alert--danger font-bold' : 'dawaa-alert dawaa-alert--warning font-bold'}>
              {summary.description}
            </div>
            <ul className="list-disc space-y-1 pr-5 leading-7">
              {summary.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
            {preview!.cases.length ? (
              <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3">
                <div className="mb-1 font-black">الحالات داخل نطاق الحذف</div>
                <ul className="space-y-1 font-mono text-[11px]">
                  {preview!.cases.map((row) => <li key={row.caseId}>{row.caseId}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="dawaa-alert dawaa-alert--info text-xs leading-6">
              لن يُحذف أو يتغير: {DELETION_UNTOUCHED_RECORDS.join('، ')}. الحذف منطقي ويُسجَّل في سجل التدقيق، ويمكن الاسترجاع من «سلة المحذوفات». إعادة التحليل لا تُعيد المحذوف إلا بعد استرجاع صريح.
            </div>
          </div>
        ) : null}

        {blockers.length ? (
          <div className="dawaa-alert dawaa-alert--danger mt-3 text-sm">
            <div className="mb-1 flex items-center gap-1 font-black"><AlertTriangle size={15} /> لا يمكن الحذف؛ أوقف النظام العملية لأن الأثر يمس سجلات مالية أو عملًا منفذًا:</div>
            <ul className="list-disc space-y-1 pr-5">
              {blockers.map((blocker, index) => (
                <li key={`${blocker.code}:${blocker.ref ?? index}`}>
                  {deletionBlockerLabel(blocker.code)}
                  {blocker.invoiceNumber ? ` — فاتورة ${blocker.invoiceNumber}` : ''}
                  {blocker.revenue != null ? ` — ${Number(blocker.revenue).toLocaleString('ar-EG')} ج.م` : ''}
                </li>
              ))}
            </ul>
            <div className="mt-1 text-xs">لم يتم تعديل أي سجل. راجع هذه السجلات يدويًا أولًا.</div>
          </div>
        ) : null}

        {canCorrectCandidate ? (
          <div className="dawaa-alert dawaa-alert--warning mt-3 space-y-3 text-sm">
            <div className="font-black">ترشيح فاتورة غير معتمد — تصحيح مستقل</div>
            <p>الفاتورة {candidate!.matchedInvoiceNumber} مرشح آلي فقط، ولم يعتمد ربطها بالمحادثة. يمكنك إزالة الترشيح بسجل تدقيق مستقل، ثم إعادة معاينة الحذف. لن تُعدّل الفاتورة أو أي نقاط أو حوافز.</p>
            <label className="block font-bold">سبب تصحيح الترشيح
              <textarea className="dawaa-input mt-1 w-full min-h-16" value={candidateReason} onChange={(e) => setCandidateReason(e.target.value)} placeholder="اشرح لماذا هذا المرشح غير صحيح" />
            </label>
            <label className="block font-bold">اكتب للتأكيد: تصحيح ربط الفاتورة
              <input className="dawaa-input mt-1 w-full" value={candidateConfirmation} onChange={(e) => setCandidateConfirmation(e.target.value)} />
            </label>
            <button type="button" className="dawaa-button dawaa-button--secondary" disabled={correctingCandidate || candidateReason.trim().length < 10 || candidateConfirmation.trim() !== 'تصحيح ربط الفاتورة'} onClick={() => void correctCandidate()}>
              {correctingCandidate ? 'جارٍ التصحيح...' : 'تصحيح المرشح وإعادة المعاينة'}
            </button>
          </div>
        ) : null}

        {summary && !preview!.blocked ? (
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-bold">
              سبب الحذف
              <textarea className="dawaa-input mt-2 w-full min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={`اكتب السبب (${DELETION_REASON_MIN_LENGTH} أحرف على الأقل)`} />
            </label>
            <label className="block text-sm font-bold">
              للتأكيد اكتب: <span className="font-black text-[var(--dawaa-status-danger-text)]">{phrase}</span>
              <input className="dawaa-input mt-2 w-full" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            </label>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {summary && !preview!.blocked ? (
            <button type="button" className="dawaa-button border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] font-black text-[var(--dawaa-status-danger-text)]" disabled={!ready} onClick={() => void submit()}>
              {submitting ? 'جارٍ الحذف...' : summary.title}
            </button>
          ) : null}
          {error && !loading ? <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => void loadPreview()}>إعادة المعاينة</button> : null}
          <button type="button" className="dawaa-button dawaa-button--secondary" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
