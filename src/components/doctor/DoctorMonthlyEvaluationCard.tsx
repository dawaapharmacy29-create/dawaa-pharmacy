import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Award, CalendarCheck, ChevronDown, ChevronUp, Lightbulb, RefreshCw, Sparkles } from 'lucide-react';
import { loadMyEvaluation, type MyEvaluation } from '@/lib/doctorEvaluation';
import type { LabAttendanceSummary } from '@/lib/evaluationLab/buildCycleScores';
import type { AxisResult, Readiness } from '@/lib/evaluationLab/scoring';
import { axisImpacts, axisTip, evaluationSignals, familyLabel, type AxisImpact, type CycleDays, type EvaluationSignal } from '@/lib/evaluationInsights';

// The doctor's monthly evaluation, same engine and rules as /evaluation-lab (v6.8).
// compact: the overview card (score, rank, what to work on). full: every axis with its evidence.

const READINESS: Record<Readiness, { label: string; tone: string }> = {
  ready: { label: 'بيانات كاملة', tone: 'dawaa-badge--success' },
  partial: { label: 'بيانات جزئية', tone: 'dawaa-badge--warning' },
  insufficient: { label: 'بيانات لسه قليلة', tone: 'dawaa-badge--danger' },
};

const lastDay = (endExclusive: string) => {
  const d = new Date(`${endExclusive}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(5, 10).split('-').reverse().join('/');
};
const dayLabel = (day: string) => day.slice(5, 10).split('-').reverse().join('/');

function cycleLine(data: MyEvaluation) {
  const c = data.cycle;
  if (!c) return 'أول يوم في الدورة: التقييم بيبدأ من بكرة';
  if (c.kind === 'closed') return `الدورة اللي فاتت ${dayLabel(c.start)} → ${lastDay(c.endExclusive)} (نهائي)`;
  return `الدورة الجارية من ${dayLabel(c.start)} لحد ${lastDay(c.endExclusive)} · ${c.elapsedDays} من ${c.totalDays} يوم`;
}

const scoreColor = (score: number) => (score >= 80 ? 'bg-emerald-400' : score >= 60 ? 'bg-amber-400' : 'bg-rose-400');

const SIGNAL_TONE: Record<EvaluationSignal['tone'], string> = {
  danger: 'border-rose-400/40 bg-rose-400/10',
  warning: 'border-amber-400/40 bg-amber-400/10',
  info: 'border-sky-400/40 bg-sky-400/10',
  success: 'border-emerald-400/40 bg-emerald-400/10',
};

function SignalsPanel({ signals }: { signals: EvaluationSignal[] }) {
  if (!signals.length) return null;
  return (
    <div className="mt-4">
      <h3 className="dawaa-title flex items-center gap-1.5 text-sm"><Sparkles size={15} /> ملاحظات على الدورة</h3>
      <ul className="mt-2 space-y-1.5">
        {signals.map((signal) => (
          <li key={signal.text} className={`rounded-xl border px-3 py-2 text-xs font-bold leading-5 ${SIGNAL_TONE[signal.tone]}`}>{signal.text}</li>
        ))}
      </ul>
    </div>
  );
}

function AxisRow({ axis, impact, tip }: { axis: AxisResult; impact?: AxisImpact; tip?: string | null }) {
  const measured = axis.status === 'measured' && axis.score !== null;
  return (
    <div className="dawaa-surface-soft rounded-xl p-3">
      <div className="flex items-start justify-between gap-2 text-sm">
        <span className="min-w-0 font-black">{axis.label}</span>
        <span className="dawaa-caption shrink-0 text-xs font-bold">
          {axis.weight ? `وزن ${axis.weight}` : 'للمعلومة'} · {measured ? `${Math.round(axis.score!)}/100` : '—'}
        </span>
      </div>
      {measured ? (
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div className={`h-full ${scoreColor(axis.score!)}`} style={{ width: `${Math.max(2, Math.min(100, axis.score!))}%` }} />
        </div>
      ) : null}
      <p className="dawaa-caption mt-1.5 text-[11px] font-bold leading-5">
        {measured ? axis.basis : `مش بيتقاس دلوقتي: ${axis.reason || 'مفيش بيانات كفاية'}${axis.weight ? ' — وزنه بيتوزع على باقي البنود، مش بيتحسب صفر' : ''}`}
      </p>
      {impact ? (
        <p className="dawaa-caption mt-1 text-[11px] font-bold leading-5">
          قيمته {impact.share} درجة من الـ 100{impact.lost >= 0.5 ? ` · بيخصم منك ${impact.lost} درجة` : axis.score! >= 99.5 ? ' · واخد درجته كاملة' : ' · تقريبًا مش بيخصم حاجة'}
          {impact.gainTo80 >= 0.5 ? ` · لو وصل 80 تكسب +${impact.gainTo80}` : ''}
        </p>
      ) : null}
      {tip ? <p className="mt-1 flex gap-1 text-[11px] font-bold leading-5 text-amber-300"><Lightbulb size={13} className="mt-0.5 shrink-0" />{tip}</p> : null}
    </div>
  );
}

function AttendancePanel({ a, elapsedDays }: { a: LabAttendanceSummary; elapsedDays: number }) {
  const tiles: Array<[string, string, string?]> = [
    ['أيام الحضور', `${a.workedDays} من ${elapsedDays}`, 'يوم عدّوا من الدورة'],
    ['الالتزام بالمواعيد', a.creditPct === null ? '—' : `${Math.round(a.creditPct)}٪`, `من ${a.resolvedDays} يوم محسوم`],
    ['متوسط التأخير', `${Math.round(a.avgLateMinutes)} د`, 'في اليوم'],
  ];
  const details = [
    `في الميعاد (لحد 15 د): ${a.onTimeDays}`,
    `تأخير لحد ساعة: ${a.halfDays}`,
    `تأخير أكتر من ساعة: ${a.lateDays}`,
    a.missingPunchDays ? `بصمة ناقصة ما اتصلحتش: ${a.missingPunchDays}` : '',
    a.absentDays ? `غياب بخصم: ${a.absentDays}` : '',
    a.pendingDays ? `بانتظار المراجعة (مش محسوبة عليك): ${a.pendingDays}` : '',
  ].filter(Boolean);
  return (
    <div className="mt-4">
      <h3 className="dawaa-title flex items-center gap-1.5 text-sm"><CalendarCheck size={15} /> الحضور والانتظام في الدورة</h3>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs font-bold">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="dawaa-surface-soft rounded-xl p-2">
            <div className="dawaa-caption">{label}</div>
            <div className="dawaa-title mt-0.5 text-sm">{value}</div>
            {hint ? <div className="dawaa-caption mt-0.5 text-[10px]">{hint}</div> : null}
          </div>
        ))}
      </div>
      <p className="dawaa-caption mt-2 text-[11px] font-bold leading-5">{details.join(' · ')}</p>
      {a.resolvedDays < a.minDays ? (
        <p className="dawaa-caption mt-1 text-[11px] font-bold">بند الانضباط بيدخل الدرجة من {a.minDays} أيام محسومة.</p>
      ) : null}
    </div>
  );
}

export default function DoctorMonthlyEvaluationCard({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  const [kind, setKind] = useState<'running' | 'closed'>('running');
  const [showInfo, setShowInfo] = useState(false);
  const query = useQuery({
    queryKey: ['doctor-evaluation-v6', kind],
    queryFn: () => loadMyEvaluation(kind),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  // The previous cycle, to spot drops (only needed while looking at the running cycle).
  const previousQuery = useQuery({
    queryKey: ['doctor-evaluation-v6', 'closed'],
    queryFn: () => loadMyEvaluation('closed'),
    staleTime: 60 * 60_000,
    retry: 0,
    enabled: kind === 'running' && !!query.data?.me,
  });
  const data = query.data;
  const me = data?.me ?? null;
  const previous = kind === 'running' ? previousQuery.data?.me ?? null : null;

  const header = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="dawaa-icon-tile h-9 w-9 shrink-0"><Award size={18} /></div>
        <div className="min-w-0">
          <div className="dawaa-title">تقييمي الشهري</div>
          {data ? <div className="dawaa-caption truncate text-[11px] font-bold">{cycleLine(data)}</div> : null}
        </div>
      </div>
      {compact ? <span className="dawaa-caption shrink-0 text-xs font-bold">التفاصيل ←</span> : (
        <button type="button" className="rounded-full p-2" onClick={() => void query.refetch()} aria-label="تحديث" disabled={query.isFetching}>
          <RefreshCw size={15} className={query.isFetching ? 'animate-spin' : ''} />
        </button>
      )}
    </div>
  );

  const kindTabs = compact ? null : (
    <div className="mt-3 flex gap-2 text-xs font-black">
      {(['running', 'closed'] as const).map((key) => (
        <button key={key} type="button" onClick={() => setKind(key)}
          className={`rounded-full border px-3 py-1 ${kind === key ? 'border-teal-400 bg-teal-400/15 text-teal-200' : 'border-white/10'}`}>
          {key === 'running' ? 'الدورة الجارية' : 'الدورة اللي فاتت'}
        </button>
      ))}
    </div>
  );

  let content;
  if (query.isLoading) {
    content = <div className="mt-3 space-y-2"><div className="dawaa-surface-soft h-16 animate-pulse rounded-2xl" /><p className="dawaa-caption text-xs font-bold">بيتحسب من بيانات الدورة… ممكن ياخد نص دقيقة أول مرة.</p></div>;
  } else if (query.isError) {
    content = (
      <div className="dawaa-alert dawaa-alert--warning mt-3 p-3 text-sm font-bold">
        <AlertTriangle size={17} />
        <span>تعذّر حساب التقييم دلوقتي.{compact ? ' افتح التفاصيل وجرّب تاني.' : <> <button type="button" className="underline" onClick={() => void query.refetch()}>جرّب تاني</button></>}</span>
      </div>
    );
  } else if (!data?.cycle) {
    content = <p className="dawaa-caption mt-3 text-sm font-bold">أول يوم في الدورة: التقييم بيبدأ يتحسب من بكرة.</p>;
  } else if (!me) {
    content = <p className="dawaa-caption mt-3 text-sm font-bold">مفيش تقييم باسمك في الدورة دي (لسه مفيش حضور أو فواتير مسجلة لك).</p>;
  } else {
    const weighted = me.axes.filter((axis) => axis.weight > 0);
    const info = me.axes.filter((axis) => axis.weight === 0);
    const focus = weighted.filter((axis) => axis.status === 'measured' && axis.score !== null && axis.score < 80)
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).slice(0, 2);
    const readiness = READINESS[me.readiness];
    const cycleDays: CycleDays = { kind: data.cycle.kind, elapsedDays: data.cycle.elapsedDays, totalDays: data.cycle.totalDays };
    const impacts = axisImpacts(me.axes);
    const signals = evaluationSignals(me, previous, cycleDays);
    // Where the points go: the measured axes that cost the most, each with its per-day action.
    const costly = weighted.filter((axis) => (impacts[axis.key]?.lost ?? 0) >= 1)
      .sort((a, b) => (impacts[b.key]?.lost ?? 0) - (impacts[a.key]?.lost ?? 0)).slice(0, 3);
    const topTip = costly.map((axis) => axisTip(axis, cycleDays)).find(Boolean) || null;
    const payout = me.compliance?.payout ?? null;
    content = (
      <>
        <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="dawaa-title text-4xl">{me.total === null ? '—' : Math.round(me.total)}</span>
          <span className="dawaa-title mb-1 text-lg">/ 100</span>
          <span className={`dawaa-badge ${readiness.tone} mb-1.5 rounded-full px-2 py-0.5 text-[11px] font-black`}>{readiness.label} · تغطية {Math.round(me.coverage * 100)}٪</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs font-bold">
          <div className="dawaa-surface-soft rounded-xl p-2"><div className="dawaa-caption">ترتيبك</div><div className="dawaa-title mt-0.5 text-sm">{data.rank ? `${data.rank} من ${data.rankOf}` : '—'}</div></div>
          <div className="dawaa-surface-soft rounded-xl p-2"><div className="dawaa-caption">وسيط {familyLabel(me.family)}</div><div className="dawaa-title mt-0.5 text-sm">{data.familyMedian === null ? '—' : Math.round(data.familyMedian)}</div></div>
          <div className="dawaa-surface-soft rounded-xl p-2"><div className="dawaa-caption">شريحة الحافز</div><div className="dawaa-title mt-0.5 text-sm">{payout === null ? '—' : `${payout}٪`}</div></div>
        </div>
        {compact && me.attendance ? (
          <p className="dawaa-caption mt-3 text-xs font-bold leading-5">
            الحضور: {me.attendance.workedDays} يوم من {data.cycle.elapsedDays} يوم عدّوا من الدورة
            {me.attendance.creditPct !== null ? ` · الالتزام بالمواعيد ${Math.round(me.attendance.creditPct)}٪` : ''}
            {me.attendance.pendingDays ? ` · ${me.attendance.pendingDays} يوم بانتظار المراجعة` : ''}
          </p>
        ) : null}
        {compact ? (
          <>
            {focus.length ? (
              <p className="dawaa-caption mt-3 text-xs font-bold leading-5">ركّز على: {focus.map((axis) => `${axis.label} (${Math.round(axis.score!)}${impacts[axis.key]?.gainTo80 ? `، +${impacts[axis.key].gainTo80} لو وصل 80` : ''})`).join(' · ')}</p>
            ) : <p className="dawaa-caption mt-3 text-xs font-bold">كل البنود اللي بتتقاس فوق 80 👏</p>}
            {topTip ? <p className="mt-2 flex gap-1 text-xs font-bold leading-5 text-amber-300"><Lightbulb size={14} className="mt-0.5 shrink-0" />{topTip}</p> : null}
            {signals[0] ? <p className={`mt-2 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold leading-5 ${SIGNAL_TONE[signals[0].tone]}`}>{signals[0].text}{signals.length > 1 ? ` (+${signals.length - 1} ملاحظة)` : ''}</p> : null}
          </>
        ) : (
          <>
            {me.compliance ? (
              <p className="dawaa-caption mt-3 text-[11px] font-bold leading-5">
                الالتزام: {me.compliance.points} نقطة مخالفات → معامل {Math.round(me.compliance.factor * 100)}٪
                {me.compliance.tierPayout !== null ? ` · شريحة الأداء ${me.compliance.tierPayout}٪ × المعامل = ${me.compliance.payout}٪` : ''}
              </p>
            ) : null}
            {costly.length ? (
              <div className="mt-4">
                <h3 className="dawaa-title text-sm">الدرجات راحت فين؟</h3>
                <p className="dawaa-caption mt-1 text-[11px] font-bold leading-5">
                  {costly.map((axis) => `${axis.label}: −${impacts[axis.key].lost}`).join(' · ')}
                  {me.total !== null && me.total < 100 ? ` — من أصل ${Math.round(100 - me.total)} درجة ناقصة` : ''}
                </p>
              </div>
            ) : null}
            <SignalsPanel signals={signals} />
            {me.attendance ? <AttendancePanel a={me.attendance} elapsedDays={data.cycle.elapsedDays} /> : null}
            <h3 className="dawaa-title mt-4 text-sm">البنود اللي بتتحسب</h3>
            <div className="mt-2 space-y-2">{weighted.map((axis) => <AxisRow key={axis.key} axis={axis} impact={impacts[axis.key]} tip={axisTip(axis, cycleDays)} />)}</div>
            {info.length ? (
              <>
                <button type="button" onClick={() => setShowInfo((v) => !v)} className="dawaa-caption mt-3 flex items-center gap-1 text-xs font-black">
                  {showInfo ? <ChevronUp size={14} /> : <ChevronDown size={14} />} بنود للمعلومة بس (مش داخلة في الدرجة)
                </button>
                {showInfo ? <div className="mt-2 space-y-2">{info.map((axis) => <AxisRow key={axis.key} axis={axis} />)}</div> : null}
              </>
            ) : null}
            <p className="dawaa-caption mt-4 text-[11px] font-bold leading-5">
              البند اللي مالوش بيانات مش بيتحسب صفر، ووزنه بيتوزع على الباقي. الدورة الجارية بتتحسب لحد امبارح، وتارجت ساعاتك على قد الأيام اللي عدّت.
              {data.computedAt ? ` آخر حساب ${new Date(data.computedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' })}.` : ''}
            </p>
          </>
        )}
      </>
    );
  }

  if (compact) {
    return <button type="button" onClick={onOpen} className="dawaa-card dawaa-card--interactive w-full p-5 text-right">{header}{content}</button>;
  }
  return <div className="dawaa-card w-full p-5 text-right">{header}{kindTabs}{content}</div>;
}
