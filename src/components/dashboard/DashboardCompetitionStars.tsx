import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, Loader2, Trophy } from 'lucide-react';
import { Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import { BRANCHES } from '@/lib/constants';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import {
  loadDesignPack,
  type DesignPack,
  type PackBranch,
} from '@/lib/doctorCompetitionDesignPack';

// «مسابقة الدكاترة» on the dashboard: the same points, stars and thresholds as the competition page
// (the eight-criterion scorecard, each doctor scored inside their own branch), for the running cycle.
// It is read only once the panel comes near the screen, so it never slows the dashboard's first load.

const STAR_TITLES = [
  'نجم الفترة',
  'الأعلى مبيعًا',
  'أعلى متوسط فاتورة',
  'بطل اللستة',
  'بطل الرواكد',
  'أفضل تقييم',
] as const;

const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Up to yesterday (the last full day of uploaded invoices), unless the cycle started today. */
export function competitionAnchorDay(today = cairoToday()) {
  const yesterday = addDays(today, -1);
  return yesterday < getPharmacyCycleRange(`${today}T12:00:00`).start ? today : yesterday;
}

const money = (value: number) => `${Math.round(value).toLocaleString('ar-EG')} ج`;
const shortDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' });

function useNearScreen<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);
  return { ref, near };
}

export function DashboardCompetitionStars({ branch }: { branch: string | null }) {
  const navigate = useNavigate();
  const { ref, near } = useNearScreen<HTMLDivElement>();
  const [pack, setPack] = useState<DesignPack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!near) return;
    let alive = true;
    setLoading(true);
    setError(null);
    loadDesignPack({
      mode: 'cycle',
      anchor: competitionAnchorDay(),
      branches: branch ? [branch] : BRANCHES,
      branch,
    })
      .then((value) => alive && setPack(value))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'تعذر تحميل المسابقة'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [near, branch, retry]);

  const open = useCallback(() => navigate('/doctor-competition?period=cycle'), [navigate]);

  return (
    <Panel id="doctor-competitions" className="p-5">
      <div ref={ref}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <SectionTitle
            title="مسابقة الدكاترة"
            subtitle={
              pack
                ? `الدورة من ${shortDate(pack.period.start)} لحد ${shortDate(pack.period.end)} · نفس نقط صفحة المسابقة، كل فرع لوحده`
                : 'نفس نقط صفحة المسابقة، كل فرع لوحده'
            }
            icon={<Trophy className="h-5 w-5" />}
          />
          <button
            type="button"
            onClick={open}
            className="dawaa-badge dawaa-badge--info inline-flex items-center gap-0.5 rounded-full px-3 py-1 text-xs font-black"
          >
            صفحة المسابقة <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        {error && !pack ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--dawaa-status-danger-border)] px-4 py-6 text-center">
            <AlertTriangle className="h-6 w-6 text-[var(--dawaa-status-danger-text)]" />
            <p className="text-sm font-bold text-[var(--dawaa-status-danger-text)]">
              تعذر تحميل مسابقة الدكاترة دلوقتي.
            </p>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
              className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-4 py-2 text-xs font-black text-[var(--dawaa-status-danger-text)]"
            >
              حاول تاني
            </button>
          </div>
        ) : !pack ? (
          <div className="dawaa-caption flex items-center gap-2 py-6 text-sm font-bold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} بنجهز المسابقة…
          </div>
        ) : (
          <div className="space-y-5">
            {pack.branches.map((row) => (
              <BranchCompetition key={row.branch} branch={row} onOpen={open} />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function BranchCompetition({ branch, onOpen }: { branch: PackBranch; onOpen: () => void }) {
  const stars = new Map(branch.stars.map((star) => [star.title, star]));
  const top = branch.doctors
    .filter((doctor) => doctor.competition_points !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5);
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="dawaa-theme-heading text-base font-black">{branch.branch}</h3>
        <span className="dawaa-caption text-[11px] font-bold">
          {money(branch.totals.sales)} · {branch.totals.invoices.toLocaleString('ar-EG')} فاتورة ·
          متوسط {money(branch.totals.average_invoice)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {STAR_TITLES.map((title) => {
          const star = stars.get(title);
          return (
            <button
              key={title}
              type="button"
              onClick={onOpen}
              className="min-w-0 rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-start transition hover:-translate-y-0.5"
            >
              <p className="flex items-center gap-1 text-[11px] font-black text-[var(--dawaa-status-warning-text)]">
                <Trophy className="h-3.5 w-3.5 shrink-0" />{' '}
                <span className="truncate">{title}</span>
              </p>
              <p className="dawaa-theme-heading mt-1.5 truncate text-sm font-black">
                {star?.name ?? 'لسه مفيش'}
              </p>
              <p className="dawaa-caption mt-0.5 truncate text-[11px] font-bold">
                {star?.value ?? 'مفيش بيانات كفاية'}
              </p>
            </button>
          );
        })}
      </div>
      {top.length ? (
        <ol className="mt-2 space-y-1.5">
          {top.map((doctor) => (
            <li key={doctor.staff_id || doctor.name}>
              <button
                type="button"
                onClick={onOpen}
                className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-start hover:bg-[var(--dawaa-theme-accent-soft)]"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--dawaa-theme-accent-soft)] text-xs font-black">
                  {doctor.rank.toLocaleString('ar-EG')}
                </span>
                <span className="min-w-0">
                  <span className="dawaa-theme-heading block truncate text-sm font-black">
                    {doctor.name}
                  </span>
                  <span className="dawaa-caption block truncate text-[11px] font-bold">
                    {doctor.invoices.toLocaleString('ar-EG')} فاتورة · متوسط{' '}
                    {money(doctor.average_invoice)}
                    {doctor.review_count
                      ? ` · تقييم ${(doctor.review_average ?? 0).toLocaleString('ar-EG')}/١٠٠ (${doctor.review_count.toLocaleString('ar-EG')})`
                      : ''}
                    {doctor.list_incentive ? ` · لستة ${money(doctor.list_incentive)}` : ''}
                    {doctor.stagnant_units
                      ? ` · رواكد ${doctor.stagnant_units.toLocaleString('ar-EG')} وحدة`
                      : ''}
                  </span>
                </span>
                <span className="text-end">
                  <span className="block text-sm font-black text-[var(--dawaa-status-warning-text)]">
                    {(doctor.competition_points ?? 0).toLocaleString('ar-EG')} نقطة
                  </span>
                  <span className="block text-[10px] font-bold text-[var(--dawaa-status-success-text)]">
                    {money(doctor.sales)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {branch.notes.length ? (
        <p className="dawaa-caption mt-1.5 text-[10px] font-bold leading-5">
          {branch.notes.join(' · ')}
        </p>
      ) : null}
    </section>
  );
}
