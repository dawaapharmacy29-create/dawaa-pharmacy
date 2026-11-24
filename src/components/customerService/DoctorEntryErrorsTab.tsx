import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
import {
  DEDUCTION_OUTCOMES,
  decideDoctorError,
  loadDoctorErrors,
  problemLabel,
  summarizeByDoctor,
  type DeductionOutcome,
  type DoctorError,
  type DoctorErrorsReport,
} from '@/lib/customerServiceTasks/morning';

// أخطاء تسجيل فواتير المشتريات والتحويلات اللي فريق خدمة العملاء لقاها في مراجعة الصبح. للمدير العام والتنفيذي بس
// (الداتابيز بترفض أي حد تاني). الخصم بيتعمل لما المدير يختار نوعه، بنقاط «دقة إدخال الفواتير».

const DECISION: Record<DoctorError['decision'], string> = {
  pending: 'مستني قرارك',
  deducted: 'اتخصم',
  dismissed: 'اتجاهل',
};

export default function DoctorEntryErrorsTab({ today }: { today: string }) {
  const [from, setFrom] = useState(() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [report, setReport] = useState<DoctorErrorsReport | null>(null);
  const [error, setError] = useState('');
  const [onlyPending, setOnlyPending] = useState(true);

  const load = useCallback(async () => {
    try {
      setError('');
      setReport(await loadDoctorErrors(from, today));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [from, today]);
  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeByDoctor(report?.rows ?? []), [report]);

  if (error)
    return (
      <Panel>
        <EmptyState label={error} />
      </Panel>
    );
  if (!report)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="animate-spin" />
      </div>
    );

  const rows = report.rows.filter((r) => !onlyPending || r.decision === 'pending');
  const pending = report.rows.filter((r) => r.decision === 'pending').length;

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle
          title="أخطاء تسجيل الفواتير"
          subtitle="من مراجعة الصبح بتاعة خدمة العملاء · ظاهرة ليك بس، والفريق مايعرفش بالخصم"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-xs font-bold">
            من
            <input
              type="date"
              className="input-field mr-1 w-auto"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <button
            className="btn-secondary inline-flex items-center gap-1"
            onClick={() => void load()}
          >
            <RefreshCw size={16} /> تحديث
          </button>
          <label className="inline-flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(e) => setOnlyPending(e.target.checked)}
            />{' '}
            اللي مستنية قرارك بس
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <MiniBox
            label="فواتير فيها أخطاء"
            value={String(report.rows.filter((r) => r.decision !== 'dismissed').length)}
            tone="amber"
          />
          <MiniBox
            label="مستنية قرارك"
            value={String(pending)}
            tone={pending ? 'amber' : 'green'}
          />
          <MiniBox label="اللي سجلوا" value={String(summary.length)} tone="blue" />
        </div>
      </Panel>

      <Panel>
        <SectionTitle title="كل واحد سجّل" subtitle="عدد الفواتير اللي فيها أخطاء وأنواعها" />
        {summary.length === 0 ? (
          <EmptyState label="مفيش أخطاء في الفترة دي" />
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right opacity-70">
                  <th className="p-2">الاسم</th>
                  <th className="p-2">فواتير فيها أخطاء</th>
                  <th className="p-2">مستنية قرار</th>
                  <th className="p-2">النقاط المخصومة</th>
                  <th className="p-2">الأخطاء</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.name} className="border-t border-[var(--dawaa-theme-border)]">
                    <td className="p-2 font-black">{s.name}</td>
                    <td className="p-2">{s.invoices}</td>
                    <td className="p-2">{s.pending}</td>
                    <td className="p-2">{s.points}</td>
                    <td className="p-2 text-xs">
                      {Object.entries(s.problems)
                        .map(([k, n]) => `${problemLabel(k)} ${n}`)
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <SectionTitle title="الفواتير" />
        {rows.length === 0 ? (
          <EmptyState label="مفيش" />
        ) : (
          <div className="mt-2 space-y-2">
            {rows.map((r) => (
              <ErrorRow key={r.id} row={r} staff={report.staff} onDone={load} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function ErrorRow({
  row: r,
  staff,
  onDone,
}: {
  row: DoctorError;
  staff: DoctorErrorsReport['staff'];
  onDone: () => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<DeductionOutcome>('mixup_unregistered');
  const [staffId, setStaffId] = useState(r.responsible_staff_id ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function decide(what: DeductionOutcome | 'dismissed') {
    if (what !== 'dismissed' && !staffId) {
      toast.error('اختار اللي سجّل الفاتورة');
      return;
    }
    setSaving(true);
    try {
      await decideDoctorError(r.id, what, staffId || null, note);
      toast.success(what === 'dismissed' ? 'اتجاهل' : 'اتسجل الخصم');
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-black">{r.responsible ?? 'مش معروف'}</span>
        <span className="text-xs opacity-70">
          {r.day} · {r.label} · {r.net != null ? `${Number(r.net).toLocaleString('ar-EG')} ج` : ''}
        </span>
        <span className="mr-auto text-xs font-black">
          {DECISION[r.decision]}
          {r.points ? ` (${r.points})` : ''}
        </span>
      </div>
      <div className="mt-1 text-xs">
        <span className="font-bold text-[var(--dawaa-status-danger-text)]">
          {r.problems.map(problemLabel).join('، ')}
        </span>
        {r.note ? ` · ${r.note}` : ''} · لقتها {r.reported_by ?? '—'}
      </div>
      {r.decision === 'pending' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="input-field w-auto"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          >
            <option value="">— اللي سجّل —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.branch ? ` · ${s.branch}` : ''}
              </option>
            ))}
          </select>
          <select
            className="input-field w-auto"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as DeductionOutcome)}
          >
            {(Object.keys(DEDUCTION_OUTCOMES) as DeductionOutcome[]).map((k) => (
              <option key={k} value={k}>
                {DEDUCTION_OUTCOMES[k]}
              </option>
            ))}
          </select>
          <input
            className="input-field w-48"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ملاحظة"
          />
          <button className="btn-primary" disabled={saving} onClick={() => void decide(outcome)}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : null} خصم
          </button>
          <button
            className="btn-secondary"
            disabled={saving}
            onClick={() => void decide('dismissed')}
          >
            تجاهل
          </button>
        </div>
      ) : r.decided_by ? (
        <div className="mt-1 text-xs opacity-70">
          {r.decided_by}
          {r.decision_note ? ` · ${r.decision_note}` : ''}
        </div>
      ) : null}
    </div>
  );
}
