import { ArrowUp, Target, Trophy } from 'lucide-react';
import type { Standing } from '@/lib/competitionStanding';

const mutedText = { color: 'var(--dawaa-theme-muted)' };
const surfaceSoft = {
  background: 'var(--dawaa-theme-bg-soft)',
  borderColor: 'var(--dawaa-theme-border)',
};
const ar = (value: number, digits = 1) =>
  value.toLocaleString('ar-EG', { maximumFractionDigits: digits });

/** "مكانك ووصولك": a doctor's place in their branch, their points per criterion, and what moves them up. */
export default function CompetitionStandingCard(props: {
  standing: Standing;
  name: string;
  branch: string;
  daysLeft: number;
  /** The signed-in doctor's own card (worded "you"), or a manager looking at a doctor. */
  own: boolean;
}) {
  const { standing, name, branch, daysLeft, own } = props;
  const first = standing.rank === 1;

  return (
    <section
      className="rounded-3xl border p-4"
      style={{ borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.06)' }}
      dir="rtl"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-amber-300">
            <Target size={18} />
            <span className="text-xs font-black">
              {own ? 'مكانك ووصولك' : `مكان ${name} ووصوله`}
            </span>
          </div>
          <div className="mt-1 text-lg font-black text-white">
            {own ? 'انت' : name} في المركز {standing.rank.toLocaleString('ar-EG')} من{' '}
            {standing.of.toLocaleString('ar-EG')} في {branch}
          </div>
          <div className="mt-1 text-xs font-bold" style={mutedText}>
            {first
              ? standing.behind
                ? `${own ? 'انت' : 'هو'} الأول، والتاني (${standing.behind.name}) ورا بـ ${ar(standing.behind.gap)} نقطة.`
                : 'الأول في الفرع.'
              : standing.ahead
                ? `ناقص ${ar(standing.ahead.gap)} نقطة عشان ${own ? 'تعدّي' : 'يعدّي'} ${standing.ahead.name} (${ar(standing.ahead.points)} نقطة).`
                : null}
            {daysLeft > 0 ? ` · فاضل ${daysLeft.toLocaleString('ar-EG')} يوم في الدورة.` : ''}
          </div>
        </div>
        <div
          className="flex shrink-0 flex-col items-center rounded-2xl px-4 py-2"
          style={{
            background: first ? '#fbbf24' : 'rgba(0,0,0,0.25)',
            color: first ? '#1B2B4B' : '#fde68a',
          }}
        >
          {first ? <Trophy size={18} /> : null}
          <span className="text-2xl font-black">{ar(standing.points)}</span>
          <span className="text-[10px] font-black">نقطة من ١٠٠</span>
        </div>
      </div>

      {standing.steps.length ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-black text-white">
            {first
              ? own
                ? 'عشان تكبّر الفرق'
                : 'عشان يكبّر الفرق'
              : own
                ? 'أسرع طريق تطلع بيه'
                : 'أسرع طريق يطلع بيه'}
          </div>
          {standing.steps.map((step) => (
            <div
              key={step.criterion}
              className="flex items-center gap-3 rounded-2xl border p-3"
              style={surfaceSoft}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399' }}
              >
                <ArrowUp size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black text-white">{step.action}</div>
                <div className="text-xs" style={mutedText}>
                  {step.label}
                  {step.perDay ? ` · يعني ${step.perDay}` : ''}
                  {step.passesNext && standing.ahead
                    ? ` · كفاية ${own ? 'تعدّي' : 'يعدّي'} ${standing.ahead.name}`
                    : ''}
                </div>
              </div>
              <span className="shrink-0 text-sm font-black text-emerald-300">
                +{ar(step.points)}
              </span>
            </div>
          ))}
          <p className="text-[11px]" style={mutedText}>
            الأرقام تقريبية: كل بند بيتقارن بأعلى دكتور في الفرع، والأعلى ممكن يزيد هو كمان.
          </p>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {standing.parts.map((part) => (
          <div key={part.criterion} className="rounded-xl border p-2" style={surfaceSoft}>
            <div
              className="flex items-baseline justify-between gap-1 text-[11px] font-bold"
              style={mutedText}
            >
              <span>{part.label}</span>
              <span>
                {part.points === null
                  ? '—'
                  : `${ar(part.points)} / ${part.weight.toLocaleString('ar-EG')}`}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full"
              style={{ background: 'rgba(148,163,184,0.2)' }}
            >
              <div
                className="h-full rounded-full bg-amber-300"
                style={{
                  width: `${part.points === null ? 0 : Math.min(100, (part.points / part.weight) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
