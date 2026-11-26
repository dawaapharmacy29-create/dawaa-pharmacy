import { useMemo, useState } from 'react';
import type { Liberation } from '@/lib/inventory/liberation';

// «رأس المال يوم بيوم» في «تحرير المخزون»: رأس المال (المخزن الرئيسي ومخازن الدكاترة) والرواكد لكل ملف رصيد اترفع،
// عشان نشوف التحرير ماشي ولا لأ. نفس الوحدة (جنيه) على محور واحد. الرواكد بتتسجل من أول يوم الصفحة اتفتحت على الملف.

type Day = { day: string; value: number; dead: number | null };

const SERIES = {
  value: {
    label: 'رأس المال',
    cls: 'stroke-[#2a78d6] dark:stroke-[#3987e5]',
    dot: 'fill-[#2a78d6] dark:fill-[#3987e5]',
  },
  dead: {
    label: 'الرواكد',
    cls: 'stroke-[#eb6834] dark:stroke-[#d95926]',
    dot: 'fill-[#eb6834] dark:fill-[#d95926]',
  },
} as const;

const money = (v: number) => `${Math.round(v).toLocaleString('ar-EG')} ج`;
const mil = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} م`
    : `${Math.round(v / 1000).toLocaleString('ar-EG')} ألف`;
const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

export function dailyTrend(trend: Liberation['trend']): Day[] {
  const m = new Map<string, Day>();
  for (const t of trend) {
    const r = m.get(t.day) ?? { day: t.day, value: 0, dead: 0 };
    r.value += Number(t.value) || 0;
    r.dead = r.dead == null || t.dead == null ? null : r.dead + Number(t.dead);
    m.set(t.day, r);
  }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function change(a: number, b: number) {
  const d = b - a;
  if (Math.abs(d) < 1) return 'ثابت';
  return `${d < 0 ? 'نزل' : 'زاد'} ${money(Math.abs(d))}`;
}

export default function LiberationTrend({ trend }: { trend: Liberation['trend'] }) {
  const days = useMemo(() => dailyTrend(trend), [trend]);
  const [hover, setHover] = useState<number | null>(null);
  if (!days.length) return null;

  const W = 640;
  const H = 200;
  const L = 52;
  const R = 74;
  const T = 14;
  const B = 26;
  const max = Math.max(...days.map((d) => d.value), 1) * 1.1;
  const x = (i: number) =>
    days.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (days.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const line = (f: (d: Day) => number | null) =>
    days
      .map((d, i) => {
        const v = f(d);
        if (v == null) return '';
        const prev = i > 0 ? f(days[i - 1]) : null;
        return `${prev == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .join(' ');
  const ticks = [0, max / 3, (2 * max) / 3];
  const first = days[0];
  const last = days[days.length - 1];
  const deadDays = days.filter((d) => d.dead != null);
  const lastI = days.length - 1;
  const h = hover == null ? null : days[hover];

  return (
    <div>
      <p className="text-xs opacity-80">
        {days.length < 2
          ? 'ده أول ملف: الخط هيبان من تاني يوم ترفعوا فيه الرصيد.'
          : `من ${dm(first.day)} لـ ${dm(last.day)}: رأس المال ${change(first.value, last.value)}${
              deadDays.length >= 2
                ? ` · الرواكد ${change(deadDays[0].dead!, deadDays[deadDays.length - 1].dead!)}`
                : ''
            }`}
      </p>
      <div className="mt-1 flex gap-3 text-xs" aria-hidden>
        {(['value', 'dead'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <svg width="14" height="4">
              <line x1="0" y1="2" x2="14" y2="2" strokeWidth="2" className={SERIES[k].cls} />
            </svg>
            {SERIES[k].label}
          </span>
        ))}
      </div>
      <div className="relative mt-1" dir="ltr">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`رأس المال يوم بيوم: آخر قيمة ${money(last.value)}`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={L}
                x2={W - R}
                y1={y(t)}
                y2={y(t)}
                className="stroke-current opacity-10"
                strokeWidth="1"
              />
              <text
                x={L - 6}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-current text-[10px] opacity-60"
              >
                {t ? mil(t) : '٠'}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            days.length <= 8 || i % Math.ceil(days.length / 8) === 0 || i === lastI ? (
              <text
                key={d.day}
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-current text-[10px] opacity-60"
              >
                {dm(d.day)}
              </text>
            ) : null
          )}
          {h ? (
            <line
              x1={x(hover!)}
              x2={x(hover!)}
              y1={T}
              y2={H - B}
              className="stroke-current opacity-25"
              strokeWidth="1"
            />
          ) : null}
          <path
            d={line((d) => d.value)}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            className={SERIES.value.cls}
          />
          <path
            d={line((d) => d.dead)}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            className={SERIES.dead.cls}
          />
          {(['value', 'dead'] as const).map((k) =>
            days.map((d, i) => {
              const v = d[k];
              if (v == null || (days.length > 1 && i !== lastI && i !== hover)) return null;
              return (
                <circle
                  key={`${k}${d.day}`}
                  cx={x(i)}
                  cy={y(v)}
                  r="4"
                  strokeWidth="2"
                  className={`${SERIES[k].dot} stroke-[var(--dawaa-theme-surface,#fff)]`}
                />
              );
            })
          )}
          {/* direct labels at the end of each line */}
          <text
            x={x(lastI) + 8}
            y={y(last.value) + 4}
            className="fill-current text-[10px] font-bold"
          >
            {mil(last.value)}
          </text>
          {last.dead != null ? (
            <text
              x={x(lastI) + 8}
              y={y(last.dead) + 4}
              className="fill-current text-[10px] font-bold"
            >
              {mil(last.dead)}
            </text>
          ) : null}
          {days.map((d, i) => {
            const w = days.length === 1 ? W - L - R : (W - L - R) / (days.length - 1);
            return (
              <rect
                key={d.day}
                x={x(i) - w / 2}
                y={T}
                width={w}
                height={H - T - B}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
              />
            );
          })}
        </svg>
        {h ? (
          <div
            dir="rtl"
            className="pointer-events-none absolute top-1 rounded-lg border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface,#fff)] px-2 py-1 text-xs shadow"
            style={{
              left: `${(100 * x(hover!)) / W}%`,
              transform: `translateX(${hover! > lastI / 2 ? '-105%' : '5%'})`,
            }}
          >
            <div className="font-black">رصيد يوم {dm(h.day)}</div>
            <div>رأس المال: {money(h.value)}</div>
            <div>الرواكد: {h.dead == null ? 'مااتسجلتش' : money(h.dead)}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
