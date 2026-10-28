import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronUp, Database, FlaskConical, Users } from 'lucide-react';
import { LAB_FAMILY_LABELS, type LabFamily } from '@/lib/evaluationLab/catalog';
import { buildCycleScores, type LabEvidence, type LabPersonScore } from '@/lib/evaluationLab/buildCycleScores';
import { closedCycles, loadCycleEvidence, type LabCycle } from '@/lib/evaluationLab/loadCycleEvidence';
import type { AxisResult, Readiness } from '@/lib/evaluationLab/scoring';

// Evaluation Lab v6 — read-only trial of the proposed monthly evaluation. Nothing is written or paid.

const FAMILIES: LabFamily[] = ['doctor', 'assistant', 'delivery', 'branch_manager', 'branches_manager'];
const READINESS: Record<Readiness, { label: string; className: string }> = {
  ready: { label: 'قابل للاعتماد', className: 'dawaa-status-success-text dawaa-status-success-bg dawaa-status-success-border' },
  partial: { label: 'بيانات جزئية', className: 'dawaa-status-warning-text dawaa-status-warning-bg dawaa-status-warning-border' },
  insufficient: { label: 'بيانات غير كافية', className: 'dawaa-status-danger-text dawaa-status-danger-bg dawaa-status-danger-border' },
};

const cycleLabel = (cycle: LabCycle) => {
  const end = new Date(`${cycle.endExclusive}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return `${cycle.start} → ${end.toISOString().slice(0, 10)}`;
};

function ScoreRing({ score }: { score: number | null }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const value = score ?? 0;
  const tone = score === null ? 'var(--dawaa-theme-border)' : value >= 70 ? 'var(--dawaa-theme-primary)' : value >= 45 ? '#d97706' : '#dc2626';
  return (
    <svg width="58" height="58" viewBox="0 0 58 58" role="img" aria-label={score === null ? 'غير محسوب' : `الدرجة ${score}`}>
      <circle cx="29" cy="29" r={r} fill="none" stroke="var(--dawaa-theme-soft)" strokeWidth="6" />
      {score !== null && (
        <circle cx="29" cy="29" r={r} fill="none" stroke={tone} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 29 29)" />
      )}
      <text x="29" y="33" textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--dawaa-theme-heading)">
        {score === null ? '—' : Math.round(score)}
      </text>
    </svg>
  );
}

function CoverageBar({ coverage }: { coverage: number }) {
  return (
    <div className="flex items-center gap-2" title="نسبة وزن المحاور التي لها بيانات">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--dawaa-theme-soft)]">
        <div className="h-full rounded-full bg-[var(--dawaa-theme-primary)]" style={{ width: `${Math.round(coverage * 100)}%` }} />
      </div>
      <span className="dawaa-theme-muted text-[11px] font-bold">تغطية {Math.round(coverage * 100)}٪</span>
    </div>
  );
}

function AxisRow({ axis }: { axis: AxisResult }) {
  const unmeasurable = axis.status === 'not_measurable';
  return (
    <div className="grid gap-1.5 py-2.5 sm:grid-cols-[minmax(150px,220px)_1fr_auto] sm:items-center sm:gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-black text-[var(--dawaa-theme-heading)]">{axis.label}</span>
        <span className="dawaa-theme-muted text-[11px] font-bold">{axis.weight ? `وزن ${axis.weight}` : 'للمعلومة'}</span>
      </div>
      <div>
        <div
          className="h-2.5 overflow-hidden rounded-full"
          style={unmeasurable
            ? { background: 'repeating-linear-gradient(45deg, var(--dawaa-theme-soft) 0 6px, transparent 6px 12px)', border: '1px dashed var(--dawaa-theme-border)' }
            : { background: 'var(--dawaa-theme-soft)' }}
        >
          {!unmeasurable && <div className="h-full rounded-full bg-[var(--dawaa-theme-primary)]" style={{ width: `${axis.score}%` }} />}
        </div>
        <p className="dawaa-theme-muted mt-1 text-[11px] leading-5">
          {unmeasurable ? `غير قابل للقياس — ${axis.reason}${axis.basis ? ` · ${axis.basis}` : ''}` : axis.basis}
        </p>
      </div>
      <div className="text-start text-sm font-black text-[var(--dawaa-theme-heading)] sm:text-end">
        {unmeasurable ? '—' : `${Math.round(axis.score as number)}/100`}
      </div>
    </div>
  );
}

function PersonCard({ person, rank }: { person: LabPersonScore; rank: number | null }) {
  const [open, setOpen] = useState(false);
  const readiness = READINESS[person.readiness];
  return (
    <div className="dawaa-card dawaa-surface rounded-2xl border border-[var(--dawaa-theme-border)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 p-3 text-start sm:p-4" aria-expanded={open}>
        <span className="dawaa-theme-muted w-6 text-center text-sm font-black">{rank ?? "—"}</span>
        <ScoreRing score={person.total} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-black text-[var(--dawaa-theme-heading)]">{person.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="dawaa-theme-muted text-xs font-bold">{person.branch || '—'}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${readiness.className}`}>{readiness.label}</span>
            <CoverageBar coverage={person.coverage} />
          </div>
        </div>
        {open ? <ChevronUp size={18} className="dawaa-theme-muted" /> : <ChevronDown size={18} className="dawaa-theme-muted" />}
      </button>
      {open && (
        <div className="border-t border-[var(--dawaa-theme-border)] px-3 pb-3 sm:px-4">
          <div className="divide-y divide-[var(--dawaa-theme-divider)]">
            {person.axes.map((axis) => <AxisRow key={axis.key} axis={axis} />)}
          </div>
          {person.team?.length ? (
            <div className="mt-3 rounded-xl bg-[var(--dawaa-theme-bg-soft)] p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-heading)]"><Users size={14} /> الفريق الذي يدخل في التقييم</div>
              <div className="flex flex-wrap gap-2">
                {person.team.map((member) => (
                  <span key={member.staffId} className="rounded-full border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-2.5 py-1 text-[11px] font-bold">
                    {member.name} · {member.total === null ? 'غير محسوب' : Math.round(member.total)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SourceStrip({ evidence }: { evidence: LabEvidence }) {
  const sources = [
    { label: 'فواتير مرتبطة بموظف', count: evidence.invoices.filter((i) => i.staffId).length },
    { label: 'مراجعات محادثات رسمية', count: evidence.reviews.length },
    { label: 'أيام حضور', count: evidence.attendance.length },
    { label: 'طلبات عملاء', count: evidence.requests.length },
    { label: 'فواتير مشتريات', count: evidence.purchases ? evidence.purchases.length : null },
    { label: 'توصيلات مرتبطة', count: evidence.invoices.filter((i) => i.deliveryStaffId).length },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((source) => (
        <span key={source.label} className="flex items-center gap-1.5 rounded-full border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-3 py-1 text-xs font-bold">
          <Database size={12} className="dawaa-theme-muted" /> {source.label}: {source.count === null ? 'غير متاح' : source.count.toLocaleString('ar-EG')}
        </span>
      ))}
      {evidence.dormantSources.includes('followups') && (
        <span className="dawaa-status-warning-text dawaa-status-warning-bg dawaa-status-warning-border flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black">
          <AlertTriangle size={12} /> متابعة العملاء: لا توجد بيانات في الدورة (لا تُحسب صفرًا)
        </span>
      )}
    </div>
  );
}

export default function EvaluationLab() {
  const cycles = useMemo(() => closedCycles(6), []);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [family, setFamily] = useState<LabFamily>('doctor');
  const cycle = cycles[cycleIndex];

  const query = useQuery({
    queryKey: ['evaluation-lab-v6', cycle.start, cycle.endExclusive],
    queryFn: async () => {
      const evidence = await loadCycleEvidence(cycle);
      return { evidence, scores: buildCycleScores(evidence) };
    },
    staleTime: 5 * 60_000,
  });

  const scores = query.data?.scores || [];
  // Only people with enough data are ranked; "insufficient" scores are listed last, unranked.
  const rankable = (p: LabPersonScore) => p.total !== null && p.readiness !== 'insufficient';
  const visible = scores
    .filter((person) => person.family === family)
    .sort((a, b) => Number(rankable(b)) - Number(rankable(a)) || (b.total ?? -1) - (a.total ?? -1));
  const counts = (key: LabFamily) => scores.filter((person) => person.family === key).length;
  const ready = visible.filter((p) => p.readiness === 'ready').length;
  const ranked = visible.filter(rankable);

  return (
    <div className="mx-auto max-w-5xl space-y-4" dir="rtl">
      <section className="dawaa-card dawaa-surface rounded-3xl border border-[var(--dawaa-theme-border)] p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--dawaa-theme-accent-soft)] text-[var(--dawaa-theme-primary)]"><FlaskConical size={22} /></div>
            <div>
              <h1 className="text-xl font-black text-[var(--dawaa-theme-heading)]">مختبر التقييم الشهري v6</h1>
              <p className="dawaa-theme-muted mt-1 text-sm leading-6">
                تقييم محسوب من البيانات الفعلية للدورة. المحور الذي ليس له بيانات لا يُحسب صفرًا، ويُعاد توزيع وزنه.
              </p>
            </div>
          </div>
          <select
            value={cycleIndex}
            onChange={(event) => setCycleIndex(Number(event.target.value))}
            className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-input)] px-3 py-2 text-sm font-bold"
            aria-label="الدورة"
          >
            {cycles.map((c, index) => <option key={c.start} value={index}>{cycleLabel(c)}</option>)}
          </select>
        </div>
        <div className="dawaa-status-info-text mt-4 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] px-3 py-2 text-xs font-bold">
          تجريبي للقراءة فقط: لا يكتب أي بيانات، ولا يغيّر التقييم الحالي أو النقاط أو الحوافز أو المرتبات.
        </div>
        {query.data && <div className="mt-4"><SourceStrip evidence={query.data.evidence} /></div>}
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {FAMILIES.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={family === key}
            onClick={() => setFamily(key)}
            className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-black ${family === key
              ? 'border-[var(--dawaa-theme-primary)] bg-[var(--dawaa-theme-primary)] text-[var(--dawaa-theme-primary-text)]'
              : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] text-[var(--dawaa-theme-heading)]'}`}
          >
            {LAB_FAMILY_LABELS[key]} {query.data ? `(${counts(key)})` : ''}
          </button>
        ))}
      </div>

      {query.isLoading && <div className="dawaa-card dawaa-surface rounded-2xl p-6 text-center text-sm font-bold">جاري حساب التقييم من بيانات الدورة…</div>}
      {query.isError && (
        <div className="dawaa-status-danger-text dawaa-status-danger-bg rounded-2xl p-4 text-sm font-bold">
          تعذر تحميل بيانات الدورة؛ لم يُحسب أي تقييم بدلًا من عرض أصفار. {(query.error as Error)?.message}
        </div>
      )}

      {query.data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'في القائمة', value: visible.length },
              { label: 'قابل للاعتماد', value: ready },
              { label: 'الوسيط', value: ranked.length ? Math.round([...ranked].sort((a, b) => (a.total as number) - (b.total as number))[Math.floor(ranked.length / 2)].total as number) : '—' },
            ].map((tile) => (
              <div key={tile.label} className="dawaa-card dawaa-surface rounded-2xl border border-[var(--dawaa-theme-border)] p-3 text-center">
                <div className="text-xl font-black text-[var(--dawaa-theme-heading)]">{tile.value}</div>
                <div className="dawaa-theme-muted text-xs font-bold">{tile.label}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {visible.length === 0
              ? <div className="dawaa-card dawaa-surface rounded-2xl p-6 text-center text-sm font-bold">لا يوجد موظفون نشطون في هذه الفئة.</div>
              : visible.map((person, index) => <PersonCard key={person.staffId} person={person} rank={rankable(person) ? index + 1 : null} />)}
          </div>
        </>
      )}
    </div>
  );
}
