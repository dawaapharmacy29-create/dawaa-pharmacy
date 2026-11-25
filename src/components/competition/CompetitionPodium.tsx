import { Crown, Medal } from 'lucide-react';

// منصة الفايزين في مسابقة الدكاترة (صاحب الصيدلية 2026-11-25): الأول في كارت دهبي كبير باسمه وتحته اللي عمله،
// وتحته التاني (فضي) والتالت (برونزي) جنب بعض.

export type PodiumWinner = {
  key: string;
  name: string;
  branch: string;
  /** The number the ranking is by (points, sales, …) and what it is. */
  headline: { value: string; label: string };
  stats: Array<{ label: string; value: string }>;
  mine?: boolean;
};

const PLACES = [
  {
    title: 'المركز الأول',
    ring: '#fbbf24',
    background: 'linear-gradient(135deg, #fde68a 0%, #fbbf24 45%, #f59e0b 100%)',
    text: '#1c1917',
    soft: 'rgba(255,255,255,0.35)',
  },
  {
    title: 'المركز التاني',
    ring: '#cbd5e1',
    background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 50%, #94a3b8 100%)',
    text: '#0f172a',
    soft: 'rgba(255,255,255,0.3)',
  },
  {
    title: 'المركز التالت',
    ring: '#d97757',
    background: 'linear-gradient(135deg, #fdba74 0%, #f97316 55%, #c2410c 100%)',
    text: '#1c0a00',
    soft: 'rgba(255,255,255,0.28)',
  },
];

function Card({ winner, place }: { winner: PodiumWinner; place: number }) {
  const style = PLACES[place];
  const first = place === 0;
  const stats = first ? winner.stats : winner.stats.slice(0, 4);
  return (
    <article
      className={`relative min-w-0 overflow-hidden rounded-3xl shadow-lg ${first ? 'p-4 sm:p-6' : 'p-3 sm:p-4'}`}
      style={{
        background: style.background,
        color: style.text,
        boxShadow: `0 0 0 2px ${style.ring}`,
      }}
    >
      <div
        className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full"
        style={{ background: 'rgba(255,255,255,0.18)' }}
      />
      <div className={`relative flex items-start gap-3 ${first ? '' : 'flex-wrap'}`}>
        <span
          className={`flex shrink-0 items-center justify-center rounded-full font-black ${first ? 'h-14 w-14 text-2xl' : 'h-10 w-10 text-lg'}`}
          style={{ background: style.soft }}
        >
          {first ? <Crown size={28} /> : <Medal size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black opacity-80">{style.title}</div>
          <div className={`truncate font-black ${first ? 'text-2xl sm:text-3xl' : 'text-lg'}`}>
            {winner.name}
          </div>
          <div className="text-xs font-bold opacity-80">
            {winner.branch}
            {winner.mine ? ' · أنت هنا' : ''}
          </div>
        </div>
        <div className={`shrink-0 text-left ${first ? '' : 'w-full sm:w-auto'}`}>
          <div className={`font-black ${first ? 'text-3xl sm:text-4xl' : 'text-2xl'}`}>
            {winner.headline.value}
          </div>
          <div className="text-[11px] font-bold opacity-80">{winner.headline.label}</div>
        </div>
      </div>
      {stats.length ? (
        <dl
          className={`relative mt-3 grid gap-2 ${first ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2'}`}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl px-2 py-1.5"
              style={{ background: style.soft }}
            >
              <dt className="text-[10px] font-bold opacity-80">{s.label}</dt>
              <dd className="text-sm font-black">{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

export default function CompetitionPodium({
  winners,
  title,
}: {
  winners: PodiumWinner[];
  title: string;
}) {
  if (!winners.length) return null;
  const [first, ...rest] = winners.slice(0, 3);
  return (
    <section className="space-y-3" aria-label="منصة الفايزين">
      <h2 className="text-lg font-black text-white">{title}</h2>
      <Card winner={first} place={0} />
      {rest.length ? (
        <div className="grid grid-cols-2 gap-3">
          {rest.map((w, i) => (
            <Card key={w.key} winner={w} place={i + 1} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
