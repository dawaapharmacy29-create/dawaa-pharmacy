import { Star } from 'lucide-react';
import { STAR_PRIZE, STAR_RULES, type BranchStar } from '@/lib/evaluationLab/branchStar';

// نجم الفرع: the same race in the lab (every doctor) and on each doctor's own page (his place in it).

const ar = (value: number) => Math.round(value).toLocaleString('ar-EG');
const pct = (value: number | null) => (value === null ? 'مش متقاس' : `${ar(value)}٪`);

export function StarBadge({ star }: { star: BranchStar }) {
  if (!star.eligible || star.rank === null) {
    return <span className="dawaa-badge rounded-full px-2 py-0.5 text-[11px] font-black" title={star.blockers.join(' · ')}>☆ خارج سباق النجم</span>;
  }
  const tone = star.rank === 1 ? 'dawaa-badge--success' : 'dawaa-badge--warning';
  return (
    <span className={`dawaa-badge ${tone} rounded-full px-2 py-0.5 text-[11px] font-black`}>
      {star.rank === 1 ? '★ نجم الفرع لحد دلوقتي' : `★ رقم ${ar(star.rank)} من ${ar(star.of)} · ورا الأول ${ar(star.gap ?? 0)} نقطة`}
    </span>
  );
}

/** The race explained: place, points per part, and what keeps the doctor out. */
export function StarRace({ star, own = false, compact = false }: { star: BranchStar; own?: boolean; compact?: boolean }) {
  const you = own ? 'إنت' : 'هو';
  const headline = !star.eligible
    ? `${you} لسه برة السباق`
    : star.rank === 1
      ? `${you} نجم الفرع لحد دلوقتي`
      : `${you} رقم ${ar(star.rank ?? 0)} من ${ar(star.of)}`;
  return (
    <div className="mt-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-black"><Star size={16} className="text-amber-400" /> نجم الفرع · {ar(STAR_PRIZE)} ج</p>
        <span className="text-sm font-black">{headline}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[11px] font-bold">
        {([
          ['النقاط', star.points === null ? '—' : ar(star.points)],
          ['المبيعات (٥٠٪)', pct(star.parts.sales)],
          ['المتابعات (٣٥٪)', pct(star.parts.followups)],
          ['الطلبات (١٥٪)', pct(star.parts.requests)],
        ] as const).map(([label, value]) => (
          <div key={label} className="dawaa-surface-soft rounded-xl p-2">
            <div className="dawaa-caption">{label}</div>
            <div className="dawaa-title mt-0.5 text-sm">{value}</div>
          </div>
        ))}
      </div>
      {compact ? (
        star.blockers.length ? <p className="dawaa-caption mt-2 text-[11px] font-bold leading-5">عشان {own ? 'تدخل' : 'يدخل'} السباق: {star.blockers.join(' · ')}.</p> : null
      ) : <p className="dawaa-caption mt-2 text-[11px] font-bold leading-5">
        {star.eligible && star.leader && star.rank !== 1
          ? `الأول دلوقتي ${star.leader.name} بـ ${ar(star.leader.points)} نقطة · الفرق ${ar(star.gap ?? 0)} نقطة. `
          : ''}
        {star.blockers.length ? `عشان ${own ? 'تدخل' : 'يدخل'} السباق: ${star.blockers.join(' · ')}. ` : ''}
        النقاط = مبيعاتك من تارجت ساعاتك ٥٠٪ + متابعاتك من نصيبك ٣٥٪ + الطلبات الكاملة من ٢٠ ×١٥٪، وكل بند لحد {ar(STAR_RULES.cap)}٪.
        شروط الدخول: مفيش غياب من غير إذن، أقل من ٣ مخالفات، أيام شغل كفاية، وتقييم الشهر {ar(STAR_RULES.minScore)}+.
      </p>}
    </div>
  );
}

/** The lab's summary: each branch's leader so far and the next two. */
export function BranchStarsSummary({ people }: { people: Array<{ staffId: string; name: string; branch: string | null; star?: BranchStar }> }) {
  const branches = new Map<string, Array<{ name: string; star: BranchStar }>>();
  for (const person of people) {
    if (!person.star?.eligible || person.star.rank === null) continue;
    const key = person.branch || '—';
    branches.set(key, [...(branches.get(key) || []), { name: person.name, star: person.star }]);
  }
  const out = people.filter((p) => p.star && !p.star.eligible).length;
  return (
    <section className="dawaa-card dawaa-surface rounded-3xl border border-[var(--dawaa-theme-border)] p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-black text-[var(--dawaa-theme-heading)]"><Star size={18} className="text-amber-400" /> نجم الفرع ({ar(STAR_PRIZE)} ج لكل فرع)</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {[...branches.entries()].map(([branch, rows]) => (
          <div key={branch} className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3">
            <p className="text-sm font-black">{branch}</p>
            <ol className="mt-1 space-y-1 text-xs font-bold">
              {rows.sort((a, b) => (a.star.rank ?? 99) - (b.star.rank ?? 99)).slice(0, 3).map((row) => (
                <li key={row.name}>{row.star.rank === 1 ? '★' : `${ar(row.star.rank ?? 0)}.`} {row.name} · {ar(row.star.points ?? 0)} نقطة</li>
              ))}
            </ol>
          </div>
        ))}
        {!branches.size ? <p className="dawaa-caption text-xs font-bold">مفيش دكتور داخل السباق لحد دلوقتي.</p> : null}
      </div>
      {out ? <p className="dawaa-caption mt-2 text-[11px] font-bold">{ar(out)} دكتور برة السباق لحد دلوقتي، والسبب مكتوب في كارت كل واحد.</p> : null}
    </section>
  );
}
