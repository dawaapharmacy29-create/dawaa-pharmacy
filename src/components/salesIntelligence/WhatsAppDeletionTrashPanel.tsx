// «سلة المحذوفات» — WhatsApp cases and conversations deleted by the general manager. Restore is an
// explicit, audited server command that reuses the same rows (no new evaluation, action or revenue).
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/utils';
import {
  DELETION_REASON_MIN_LENGTH,
  DELETION_TRASH_PAGE_SIZE,
  deletionBlockerLabel,
  deletionErrorMessage,
  listWhatsAppDeletions,
  newDeletionRequestKey,
  restoreWhatsAppDeletion,
  RESTORE_CONFIRMATION_PHRASE,
  type DeletionTrashRow,
} from '@/lib/salesIntelligence/operations/whatsappDeletionService';

export function WhatsAppDeletionTrashPanel() {
  const [status, setStatus] = useState<'deleted' | 'restored'>('deleted');
  const [rows, setRows] = useState<DeletionTrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<DeletionTrashRow | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const requestKey = useRef(newDeletionRequestKey());

  async function load(before: string | null = null) {
    setLoading(true);
    setError(null);
    try {
      const page = await listWhatsAppDeletions(supabase, { status, before });
      setRows((current) => (before ? [...current, ...page] : page));
    } catch (cause) {
      setError(deletionErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // load depends only on status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function open(row: DeletionTrashRow) {
    setSelected(row);
    setReason('');
    setConfirmation('');
    setMessage(null);
    setError(null);
    requestKey.current = newDeletionRequestKey();
  }

  async function restore() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await restoreWhatsAppDeletion(supabase, {
        deletionId: selected.id,
        reason: reason.trim(),
        confirmation: confirmation.trim(),
        requestKey: requestKey.current,
      });
      if (result.kind === 'blocked') {
        setError(`لم يتم الاسترجاع: ${result.blockers.map((b) => deletionBlockerLabel(b.code)).join('، ')}`);
        return;
      }
      const skipped = result.skippedEvaluationIds.length + result.skippedActionIds.length;
      setMessage(result.kind === 'restored'
        ? `تم الاسترجاع وتسجيل حدث تدقيق جديد.${skipped ? ` لم يُسترجع ${skipped.toLocaleString('ar-EG')} عنصرًا تغيّر بعد الحذف (لتجنب التكرار).` : ''} أعد التحليل صراحةً إذا لزم.`
        : 'هذا العنصر مسترجع بالفعل.');
      setSelected(null);
      await load();
    } catch (cause) {
      setError(deletionErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  const ready = !submitting && reason.trim().length >= DELETION_REASON_MIN_LENGTH && confirmation.trim() === RESTORE_CONFIRMATION_PHRASE;

  return (
    <section className="dawaa-card space-y-3" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-black">سلة المحذوفات — محادثات وحالات واتساب</h2>
          <div className="dawaa-muted text-xs">للمدير العام فقط. السجلات التاريخية والمالية محفوظة؛ الاسترجاع يسجل حدثًا جديدًا.</div>
        </div>
        <div className="flex gap-2">
          <button type="button" className={status === 'deleted' ? 'dawaa-badge dawaa-badge--info px-3 py-2' : 'dawaa-button dawaa-button--ghost text-xs'} onClick={() => setStatus('deleted')}>المحذوف حاليًا</button>
          <button type="button" className={status === 'restored' ? 'dawaa-badge dawaa-badge--info px-3 py-2' : 'dawaa-button dawaa-button--ghost text-xs'} onClick={() => setStatus('restored')}>تم استرجاعه</button>
          <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => void load()} aria-label="تحديث"><RefreshCw size={14} /></button>
        </div>
      </div>
      {error ? <div className="dawaa-alert dawaa-alert--danger text-sm">{error}</div> : null}
      {message ? <div className="dawaa-alert dawaa-alert--success text-sm">{message}</div> : null}
      {!loading && !rows.length && !error ? <div className="dawaa-empty-state py-8 text-center text-sm">لا توجد عناصر.</div> : null}
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-black">
                {row.scope === 'conversation' ? 'محادثة كاملة' : 'حالة واحدة'} — {row.customerName || 'عميل غير مسمى'}{row.customerCode ? ` (${row.customerCode})` : ''}
              </div>
              {row.status === 'deleted' && row.restorable ? (
                <button type="button" className="dawaa-button dawaa-button--secondary text-xs" onClick={() => open(row)}><RotateCcw size={14} /> استرجاع</button>
              ) : null}
              {row.status === 'deleted' && !row.restorable ? <span className="dawaa-muted text-xs">استرجع المحادثة أولًا</span> : null}
            </div>
            <div className="dawaa-muted mt-1 text-xs leading-6">
              حُذف بواسطة {row.deletedBy || 'غير معروف'} في {formatDateTime(row.deletedAt)} — السبب: {row.reason}
              <br />الحالات: {row.caseIds.length.toLocaleString('ar-EG')} — تقييمات أُخرجت: {row.evaluations.toLocaleString('ar-EG')} — إجراءات سُحبت: {row.actions.toLocaleString('ar-EG')} — {row.branch || 'بدون فرع'}
              {row.restoredAt ? <><br />استُرجع بواسطة {row.restoredBy || 'غير معروف'} في {formatDateTime(row.restoredAt)} — {row.restoreReason}</> : null}
            </div>
          </div>
        ))}
      </div>
      {rows.length && rows.length % DELETION_TRASH_PAGE_SIZE === 0 ? (
        <button type="button" className="dawaa-button dawaa-button--ghost text-xs" disabled={loading} onClick={() => void load(rows[rows.length - 1].deletedAt)}>عرض المزيد</button>
      ) : null}

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-2xl">
            <h3 className="text-lg font-black">استرجاع {selected.scope === 'conversation' ? 'المحادثة وكل حالاتها المحذوفة معها' : 'الحالة'}</h3>
            <p className="dawaa-muted mt-1 text-xs leading-6">
              تُعاد نفس الحالات والتقييمات والإجراءات المسحوبة كما كانت، دون إنشاء تقييم أو إجراء أو إيراد جديد. ما تغيّر بعد الحذف لا يُسترجع تلقائيًا.
            </p>
            <label className="mt-3 block text-sm font-bold">
              سبب الاسترجاع
              <textarea className="dawaa-input mt-2 w-full min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <label className="mt-3 block text-sm font-bold">
              للتأكيد اكتب: <span className="font-black">{RESTORE_CONFIRMATION_PHRASE}</span>
              <input className="dawaa-input mt-2 w-full" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            </label>
            <div className="mt-4 flex gap-2">
              <button type="button" className="dawaa-button dawaa-button--primary" disabled={!ready} onClick={() => void restore()}>{submitting ? 'جارٍ الاسترجاع...' : 'استرجاع'}</button>
              <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => setSelected(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
