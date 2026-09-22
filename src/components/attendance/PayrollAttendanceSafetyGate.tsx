import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  comparePayrollStagedSnapshot,
  getPayrollFinalizationGate,
  getPayrollFinalSnapshotPreview,
  listPayrollSnapshotAudit,
  listPayrollSnapshotReviews,
  listPayrollStagedSnapshots,
  reviewPayrollStagedSnapshot,
  stagePayrollFinalSnapshot,
  type PayrollFinalizationGate,
  type PayrollFinalSnapshotPreview,
  type PayrollSnapshotAuditRow,
  type PayrollSnapshotReviewRow,
  type PayrollStagedSnapshot,
} from '@/lib/hr/workforceService';

export default function PayrollAttendanceSafetyGate({ staffId, monthCycle }: { staffId: string; monthCycle: string }) {
  const [gate, setGate] = useState<PayrollFinalizationGate | null>(null);
  const [snapshot, setSnapshot] = useState<PayrollFinalSnapshotPreview | null>(null);
  const [staged, setStaged] = useState<PayrollStagedSnapshot[]>([]);
  const [audit, setAudit] = useState<PayrollSnapshotAuditRow[]>([]);
  const [snapshotNote, setSnapshotNote] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewsBySnapshot, setReviewsBySnapshot] = useState<Record<string, PayrollSnapshotReviewRow[]>>({});
  const [compareResult, setCompareResult] = useState<{ snapshotId: string; unchanged: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!staffId || !monthCycle) return;
    setLoading(true);
    try {
      const [gateResult, snapshotResult, stagedResult, auditResult] = await Promise.all([
        getPayrollFinalizationGate(staffId, monthCycle),
        getPayrollFinalSnapshotPreview(staffId, monthCycle),
        listPayrollStagedSnapshots(staffId, monthCycle, 10),
        listPayrollSnapshotAudit(staffId, monthCycle, 20),
      ]);
      setGate(gateResult);
      setSnapshot(snapshotResult);
      setStaged(stagedResult);
      setAudit(auditResult);
      const reviewPairs = await Promise.all(
        stagedResult.slice(0, 5).map(async (row) => [row.id, await listPayrollSnapshotReviews(row.id, 10)] as const)
      );
      setReviewsBySnapshot(Object.fromEntries(reviewPairs));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر فحص جاهزية الحضور للمرتب');
      setGate(null);
      setSnapshot(null);
      setStaged([]);
      setAudit([]);
      setReviewsBySnapshot({});
    } finally {
      setLoading(false);
    }
  }, [monthCycle, staffId]);

  async function stageSnapshot() {
    if (!staffId || !monthCycle) return;
    setLoading(true);
    try {
      const result = await stagePayrollFinalSnapshot({
        staffId,
        monthCycle,
        note: snapshotNote,
      });
      toast.success(result.existing
        ? 'نفس Snapshot موجود بالفعل؛ تم تسجيل Reuse في الـAudit بدون تكرار البيانات.'
        : 'تم حفظ Snapshot staged ثابت للمراجعة — بدون اعتماد أو دفع.');
      setSnapshotNote('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ Snapshot staged');
    } finally {
      setLoading(false);
    }
  }

  async function compareSnapshot(snapshotId: string) {
    setLoading(true);
    try {
      const result = await comparePayrollStagedSnapshot(snapshotId);
      setCompareResult({ snapshotId, unchanged: result.unchanged });
      if (result.unchanged) {
        toast.success('Snapshot المخزنة مطابقة تمامًا للحالة الحالية.');
      } else {
        toast.warning('الحالة الحالية تغيّرت عن Snapshot المخزنة؛ راجع الفروق قبل أي اعتماد.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر مقارنة Snapshot');
    } finally {
      setLoading(false);
    }
  }

  async function reviewSnapshot(snapshotId: string, decision: 'approved' | 'rejected') {
    if (decision === 'rejected' && !reviewNote.trim()) {
      toast.warning('اكتب سبب الرفض في ملاحظة المراجعة أولًا.');
      return;
    }
    setLoading(true);
    try {
      await reviewPayrollStagedSnapshot({
        snapshotId,
        decision,
        note: reviewNote,
      });
      toast.success(decision === 'approved'
        ? 'تم اعتماد المراجعة فقط — لم يحدث Finalize أو دفع.'
        : 'تم تسجيل رفض المراجعة بدون أي أثر مالي.');
      setReviewNote('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل قرار المراجعة');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [load]);

  if (!gate) {
    return (
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-black text-[var(--dawaa-theme-muted)]">Payroll Safety Gate</div>
          <button onClick={() => void load()} className="btn-secondary !px-2"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="mt-2 text-sm font-bold text-[var(--dawaa-theme-muted)]">لم يتم تحميل فحص الجاهزية بعد.</div>
      </div>
    );
  }

  return (
    <section className={`rounded-2xl border p-4 ${gate.ready
      ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]'
      : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            {gate.ready ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}
            بوابة الإقفال المالي للمرتب
          </div>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            {gate.ready
              ? 'Attendance Truth وPolicy V3 والأوفر تايم والـdrift سليمة لهذه الدورة، ويمكن الانتقال لخطوة الاعتماد المالي.'
              : 'الإقفال المالي محجوب حتى يتم إغلاق موانع Attendance Truth وPolicy Engine والأوفر تايم أدناه.'}
          </p>
        </div>
        <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> إعادة الفحص</button>
      </div>

      {!!gate.blockers.length && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {gate.blockers.map((item) => (
            <div key={item.code} className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-theme-surface)] p-3 text-xs font-bold">
              <div className="flex items-center gap-2 text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={14} /> {item.label}</div>
              {item.count != null && <div className="mt-1 text-[var(--dawaa-theme-muted)]">العدد: {item.count.toLocaleString('ar-EG')}</div>}
              {item.hours != null && <div className="mt-1 text-[var(--dawaa-theme-muted)]">الساعات: {Number(item.hours).toFixed(2)}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="أيام Policy مفحوصة" value={gate.policy_validation.checked_days} />
        <Metric label="V2/V3 mismatch" value={gate.policy_validation.effective_status_changes} warn={gate.policy_validation.effective_status_changes > 0} />
        <Metric label="V3 materialized" value={gate.policy_validation.v3_materialized_days} />
        <Metric label="V3 pending" value={gate.policy_validation.v3_pending_days} warn={gate.policy_validation.v3_pending_days > 0} />
      </div>

      {snapshot && (
        <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 text-xs">
          <div className="font-black text-[var(--dawaa-theme-heading)]">Final Snapshot Preview</div>
          <div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">
            {snapshot.snapshot_schema} · {snapshot.snapshot_mode === 'preview_only' ? 'Preview فقط — بدون كتابة مالية' : snapshot.snapshot_mode}
          </div>
          <div className="mt-2 break-all font-mono text-[10px] text-[var(--dawaa-theme-muted)]">
            fingerprint: {snapshot.snapshot_fingerprint}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              value={snapshotNote}
              onChange={(e) => setSnapshotNote(e.target.value)}
              placeholder="ملاحظة اختيارية على النسخة staged"
              className="input-dark w-full"
            />
            <button onClick={() => void stageSnapshot()} disabled={loading} className="btn-secondary">
              <Save size={14} /> حفظ Snapshot staged
            </button>
          </div>
          <div className="mt-2 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
            الحفظ هنا للمراجعة والتدقيق فقط. لا يغيّر الراتب ولا يعتبر Finalize أو Paid.
          </div>
        </div>
      )}

      {!!staged.length && (
        <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
          <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-heading)]"><History size={14} /> Snapshot Staging History</div>
          <div className="mt-2">
            <input
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="ملاحظة المراجعة — مطلوبة عند الرفض"
              className="input-dark w-full"
            />
          </div>
          <div className="mt-2 space-y-2">
            {staged.slice(0, 5).map((row) => (
              <div key={row.id} className="rounded-lg border border-[var(--dawaa-theme-border)] p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-black text-[var(--dawaa-theme-heading)]">
                      {new Date(row.created_at).toLocaleString('ar-EG')} · {row.finalization_ready ? 'Ready وقت الحفظ' : 'Blocked وقت الحفظ'}
                    </div>
                    <div className="mt-1 break-all font-mono text-[10px] text-[var(--dawaa-theme-muted)]">{row.snapshot_fingerprint}</div>
                    {row.note && <div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">{row.note}</div>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => void compareSnapshot(row.id)} className="btn-secondary !px-2 !py-1">
                      مقارنة بالحالي
                    </button>
                    <button
                      onClick={() => void reviewSnapshot(row.id, 'approved')}
                      disabled={loading || !row.finalization_ready}
                      className="btn-secondary !px-2 !py-1"
                    >
                      اعتماد المراجعة
                    </button>
                    <button
                      onClick={() => void reviewSnapshot(row.id, 'rejected')}
                      disabled={loading}
                      className="btn-secondary !px-2 !py-1"
                    >
                      رفض المراجعة
                    </button>
                  </div>
                </div>
                {!!reviewsBySnapshot[row.id]?.length && (
                  <div className="mt-2 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
                    آخر مراجعة: {reviewsBySnapshot[row.id][0].decision === 'approved' ? 'معتمدة للمراجعة' : 'مرفوضة'} · {reviewsBySnapshot[row.id][0].reviewer_name} · {new Date(reviewsBySnapshot[row.id][0].created_at).toLocaleString('ar-EG')}
                  </div>
                )}
                {compareResult?.snapshotId === row.id && (
                  <div className={compareResult.unchanged
                    ? 'mt-2 text-[11px] font-black text-[var(--dawaa-status-success-text)]'
                    : 'mt-2 text-[11px] font-black text-[var(--dawaa-status-warning-text)]'}>
                    {compareResult.unchanged ? 'مطابقة للحالة الحالية' : 'توجد تغييرات عن النسخة المخزنة'}
                  </div>
                )}
              </div>
            ))}
          </div>
          {!!audit.length && (
            <div className="mt-3 border-t border-[var(--dawaa-theme-border)] pt-2 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
              Audit: {audit.slice(0, 5).map((row) => `${row.action} · ${row.actor_name || 'النظام'} · ${new Date(row.created_at).toLocaleString('ar-EG')}`).join(' | ')}
            </div>
          )}
        </div>
      )}

      {!!gate.warnings.length && (
        <div className="mt-3 space-y-2">
          {gate.warnings.map((item) => (
            <div key={item.code} className="rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
              {item.label}{item.count != null ? ` · ${item.count.toLocaleString('ar-EG')}` : ''}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
        القاعدة: الإقفال المالي لا يعتمد على زر الواجهة. الـBackend يعيد فحص Attendance Truth + V2/V3 + OT + Financial Drift + هوية الفرع قبل اعتبار الدورة جاهزة.
      </div>
    </section>
  );
}


function Metric({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={warn
      ? 'rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-theme-surface)] p-3'
      : 'rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3'}>
      <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}
