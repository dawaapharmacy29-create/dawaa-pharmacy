import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import type { DecisionIntelligence } from '@/lib/evaluations/doctorDecisionIntelligence';

type Tab = 'trend' | 'peers' | 'shifts' | 'quality';
const TABS: { key: Tab; label: string }[] = [
  { key: 'trend', label: 'التطور' },
  { key: 'peers', label: 'الزملاء' },
  { key: 'shifts', label: 'الشيفتات' },
  { key: 'quality', label: 'الجودة والانضباط' },
];

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** Cycle 26→25 is named after the month it ends in. */
export const cycleName = (start: string) => { const m = Number(start.slice(5, 7)); return MONTHS[m % 12]; };
const n0 = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
const n1 = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** SVG attributes cannot read CSS variables, so resolve the theme tokens once per render surface. */
function useThemeColors() {
  const [colors, setColors] = useState({ primary: '#0f766e', muted: '#94a3b8', text: '#334155', grid: '#e2e8f0', surface: '#ffffff', danger: '#b91c1c' });
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    setColors(c => ({
      primary: read('--dawaa-theme-primary', c.primary),
      muted: read('--dawaa-theme-muted', c.muted),
      text: read('--dawaa-theme-text', c.text),
      grid: read('--dawaa-theme-divider', read('--dawaa-theme-border', c.grid)),
      surface: read('--dawaa-theme-surface', c.surface),
      danger: read('--dawaa-status-danger-text', c.danger),
    }));
  }, []);
  return colors;
}

function TipBox({ title, lines }: { title: string; lines: (string | null | false)[] }) {
  return <div dir="rtl" className="rounded-lg border px-3 py-2 text-[11px] font-bold leading-5 shadow-lg" style={{ background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-text)', maxWidth: 260 }}>
    <div className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{title}</div>
    {lines.filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
  </div>;
}

function Legend({ items }: { items: { color: string; label: string; swatch?: 'dot' | 'band' | 'diamond' }[] }) {
  return <div dir="rtl" className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
    {items.map(i => <span key={i.label} className="inline-flex items-center gap-1.5">
      <span aria-hidden style={i.swatch === 'band' ? { width: 14, height: 8, borderRadius: 3, background: i.color, opacity: 0.3 } : i.swatch === 'diamond' ? { width: 8, height: 8, background: i.color, transform: 'rotate(45deg)' } : { width: 9, height: 9, borderRadius: 9, background: i.color }} />{i.label}
    </span>)}
  </div>;
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[360px] text-[11px] font-bold">
    <thead><tr style={{ color: 'var(--dawaa-theme-muted)' }}>{head.map(h => <th key={h} className="p-1.5 text-right font-black">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="border-t tabular-nums" style={{ borderColor: 'var(--dawaa-theme-border)' }}>{r.map((c, j) => <td key={j} className="p-1.5">{c}</td>)}</tr>)}</tbody>
  </table></div>;
}

export default function DoctorDecisionChart({ data }: { data: DecisionIntelligence }) {
  const [tab, setTab] = useState<Tab>('trend');
  const [asTable, setAsTable] = useState(false);
  const c = useThemeColors();
  const axis = { fontSize: 11, fill: c.muted };
  const trend = useMemo(() => data.charts.trend.map(p => ({ ...p, name: cycleName(p.cycleStart), pct: p.index === null ? null : Math.round(p.index * 100) })), [data]);
  const peers = useMemo(() => data.charts.peers.map(p => ({ ...p, pct: Math.round(p.index * 100), y: 1 })), [data]);
  const band = data.charts.peerBand;
  const shifts = useMemo(() => data.charts.shifts.map(s => ({ ...s, bandStart: s.p25 ?? 0, bandSize: s.p25 !== null && s.p75 !== null ? s.p75 - s.p25 : 0 })), [data]);
  const quality = useMemo(() => data.charts.quality.map(q => ({ ...q, name: cycleName(q.cycleStart), latePct: q.lateShare === null ? null : Math.round(q.lateShare * 100) })), [data]);
  const empty = (msg: string) => <div className="flex h-[200px] items-center justify-center px-6 text-center text-[12px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{msg}</div>;

  const caption: Record<Tab, string> = {
    trend: 'الإنتاجية المعدلة بالشيفت عبر الدورات — 100% = متوسط زملاء الفرع لنفس مزيج الشيفتات',
    peers: 'موقعه بين زملاء الفرع المؤهلين بعد معادلة الشيفتات — المنطقة المظللة = النطاق الأوسط (25%–75%)',
    shifts: 'مبيعات الساعة في كل شيفت مقابل النطاق المعتاد للزملاء في نفس الشيفت (آخر 4 دورات)',
    quality: 'نسبة أيام التأخير وجودة المحادثات لكل دورة — كل مؤشر في رسم مستقل',
  };

  return <section className="rounded-2xl border p-3 sm:p-4" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="tablist" aria-label="نوع التحليل" className="inline-flex rounded-xl border p-0.5" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
        {TABS.map(t => <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)} className="rounded-lg px-2.5 py-1.5 text-[11px] font-black sm:px-3 sm:text-[12px]" style={tab === t.key ? { background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-heading)', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: 'var(--dawaa-theme-muted)' }}>{t.label}</button>)}
      </div>
      <button type="button" onClick={() => setAsTable(v => !v)} className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>{asTable ? 'عرض كرسم' : 'عرض كجدول'}</button>
    </div>
    <p className="mt-2 text-[11px] font-bold leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>{caption[tab]}</p>

    <div className="mt-2" dir="ltr">
      {tab === 'trend' ? (!trend.some(p => p.pct !== null) ? empty('لا توجد دورة مؤهلة لحساب الإنتاجية المعدلة بعد.')
        : asTable || trend.filter(p => p.pct !== null).length < 2 ? <div dir="rtl">{!asTable ? <p className="mb-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>دورة واحدة فقط مؤهلة للمقارنة؛ لا يُرسم اتجاه من نقطة واحدة. أسباب استبعاد باقي الدورات:</p> : null}<Table head={['الدورة', 'الإنتاجية المعدلة', 'مبيعات/ساعة', 'ساعات', 'فواتير', 'ملاحظة']} rows={trend.map(p => [p.name, p.pct === null ? 'غير مؤهلة' : `${n0(p.pct)}%`, p.salesPerHour === null ? '—' : `${n0(p.salesPerHour)} ج`, n0(p.hours), n0(p.invoices), p.note || '—'])} /></div>
        : <ResponsiveContainer width="100%" height={210}>
            <LineChart data={trend} margin={{ top: 12, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={c.grid} vertical={false} />
              <XAxis dataKey="name" reversed tick={axis} tickLine={false} axisLine={{ stroke: c.grid }} />
              <YAxis orientation="right" tick={axis} tickLine={false} axisLine={false} width={40} unit="%" domain={[(min: number) => Math.min(70, Math.floor(min / 10) * 10), (max: number) => Math.max(130, Math.ceil(max / 10) * 10)]} />
              <ReferenceLine y={100} stroke={c.muted} strokeWidth={1} label={{ value: 'متوسط الفرع', position: 'insideTopLeft', fill: c.muted, fontSize: 10 }} />
              <Tooltip cursor={{ stroke: c.grid }} content={({ active, payload }) => active && payload?.[0] ? (() => { const p = payload[0].payload as typeof trend[number]; return <TipBox title={`دورة ${p.name}`} lines={[p.pct === null ? `غير مؤهلة: ${p.note}` : `الإنتاجية المعدلة ${n0(p.pct)}% من متوسط الفرع لنفس الشيفتات`, p.salesPerHour !== null && `مبيعات الساعة ${n0(p.salesPerHour)} ج`, `${n0(p.hours)} ساعة · ${n0(p.invoices)} فاتورة داخل الحضور`]} />; })() : null} />
              <Line type="linear" dataKey="pct" stroke={c.primary} strokeWidth={2} dot={{ r: 4, fill: c.primary, stroke: c.surface, strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>) : null}

      {tab === 'peers' ? (!band ? empty(data.indicators.peers.detail)
        : asTable ? <div dir="rtl"><Table head={['', 'الإنتاجية المعدلة', 'ساعات']} rows={[...peers].sort((a, b) => b.pct - a.pct).map(p => [p.isTarget ? <b key="t">{p.label}</b> : p.label, `${n0(p.pct)}%`, n0(p.hours)])} /></div>
        : <ResponsiveContainer width="100%" height={150}>
            <ScatterChart margin={{ top: 22, right: 16, bottom: 4, left: 16 }}>
              <CartesianGrid stroke={c.grid} vertical horizontal={false} />
              <XAxis type="number" dataKey="pct" reversed tick={axis} tickLine={false} axisLine={{ stroke: c.grid }} unit="%" domain={[(min: number) => Math.floor(Math.min(min, band.p25 * 100) / 10) * 10 - 10, (max: number) => Math.ceil(Math.max(max, band.p75 * 100) / 10) * 10 + 10]} />
              <YAxis type="number" dataKey="y" hide domain={[0, 2]} />
              <ZAxis range={[90, 90]} />
              <ReferenceArea x1={Math.round(band.p25 * 100)} x2={Math.round(band.p75 * 100)} y1={0} y2={2} fill={c.muted} fillOpacity={0.12} stroke="none" />
              <ReferenceLine x={Math.round(band.median * 100)} stroke={c.muted} label={{ value: 'الوسيط', position: 'top', fill: c.muted, fontSize: 10 }} />
              <Tooltip cursor={false} content={({ active, payload }) => active && payload?.[0] ? (() => { const p = payload[0].payload as typeof peers[number]; return <TipBox title={p.label} lines={[`الإنتاجية المعدلة ${n0(p.pct)}%`, `${n0(p.hours)} ساعة حضور في الدورة`, p.isTarget ? `الوسيط ${n0(band.median * 100)}% · النطاق ${n0(band.p25 * 100)}–${n0(band.p75 * 100)}%` : 'هوية الزميل مخفية؛ المقارنة على نفس قواعد الأهلية']} />; })() : null} />
              <Scatter data={peers.filter(p => !p.isTarget)} fill={c.muted} fillOpacity={0.55} isAnimationActive={false} />
              <Scatter data={peers.filter(p => p.isTarget)} fill={c.primary} stroke={c.surface} strokeWidth={2} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>) : null}
      {tab === 'peers' && band && !asTable ? <Legend items={[{ color: c.primary, label: data.charts.peers.find(p => p.isTarget)?.label || 'الدكتور' }, { color: c.muted, label: 'زميل مؤهل' }, { color: c.muted, label: 'النطاق الأوسط للزملاء', swatch: 'band' }]} /> : null}

      {tab === 'shifts' ? (!shifts.length ? empty('لا يوجد شيفت بساعات كافية لهذا الدكتور في نطاق التحليل.')
        : asTable ? <div dir="rtl"><Table head={['الشيفت', 'مبيعات/ساعة', 'المرجع', 'نطاق الزملاء', 'ساعات', 'الثقة']} rows={shifts.map(s => [s.label, `${n0(s.actual)} ج`, s.expected === null ? '—' : `${n0(s.expected)} ج`, s.p25 === null ? 'عينة غير كافية' : `${n0(s.p25)}–${n0(s.p75!)} ج`, n0(s.hours), s.confidence === 'high' ? 'عالية' : s.confidence === 'medium' ? 'متوسطة' : 'منخفضة'])} /></div>
        : <ResponsiveContainer width="100%" height={Math.max(120, shifts.length * 56 + 40)}>
            <ComposedChart layout="vertical" data={shifts} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid stroke={c.grid} horizontal={false} />
              <XAxis type="number" reversed tick={axis} tickLine={false} axisLine={{ stroke: c.grid }} tickFormatter={(v: number) => n0(v)} />
              <YAxis type="category" dataKey="label" orientation="right" tick={{ ...axis, fill: c.text }} tickLine={false} axisLine={false} width={56} />
              <Tooltip cursor={{ fill: c.grid, fillOpacity: 0.3 }} content={({ active, payload }) => active && payload?.[0] ? (() => { const s = payload[0].payload as typeof shifts[number]; return <TipBox title={`الشيفت ال${s.label}`} lines={[`مبيعات الساعة ${n0(s.actual)} ج على ${n0(s.hours)} ساعة و${n0(s.invoices)} فاتورة`, s.expected !== null && `مرجع الفرع لنفس الشيفت ${n0(s.expected)} ج/ساعة`, s.p25 !== null ? `النطاق المعتاد للزملاء ${n0(s.p25)}–${n0(s.p75!)} ج (${n0(s.peers)} زملاء)` : 'عدد الزملاء في هذا الشيفت غير كافٍ لنطاق موثوق', `الثقة: ${s.confidence === 'high' ? 'عالية' : s.confidence === 'medium' ? 'متوسطة' : 'منخفضة'}`]} />; })() : null} />
              <Bar dataKey="bandStart" stackId="band" fill="transparent" isAnimationActive={false} barSize={14} />
              <Bar dataKey="bandSize" stackId="band" fill={c.muted} fillOpacity={0.22} radius={4} isAnimationActive={false} barSize={14} />
              <Scatter dataKey="expected" fill={c.muted} shape="diamond" isAnimationActive={false} />
              <Scatter dataKey="actual" fill={c.primary} stroke={c.surface} strokeWidth={2} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>) : null}
      {tab === 'shifts' && shifts.length && !asTable ? <Legend items={[{ color: c.primary, label: 'الفعلي' }, { color: c.muted, label: 'مرجع الفرع لنفس الشيفت', swatch: 'diamond' }, { color: c.muted, label: 'النطاق المعتاد للزملاء', swatch: 'band' }]} /> : null}

      {tab === 'quality' ? (asTable || !quality.some(q => q.latePct !== null || q.coreAverage !== null)
        ? (!quality.some(q => q.latePct !== null || q.coreAverage !== null) ? empty('لا توجد بيانات حضور أو مراجعات كافية.') : <div dir="rtl"><Table head={['الدورة', 'التأخير', 'جودة المحادثات', 'مراجعات', 'أخطاء طبية']} rows={quality.map(q => [q.name, q.lateDays === null ? 'غير متاح' : `${n0(q.lateDays)} من ${n0(q.workedDays || 0)} يوم`, q.coreAverage === null ? 'عينة غير كافية' : `${n1(q.coreAverage)}/10`, n0(q.reviews), q.medicalErrors ? <b key="m" style={{ color: 'var(--dawaa-status-danger-text)' }}>{n0(q.medicalErrors)}</b> : '0'])} /></div>)
        : <div className="grid gap-3 sm:grid-cols-2">
            {[{ key: 'latePct' as const, title: 'نسبة أيام التأخير', unit: '%', domain: [0, 100] as [number, number] }, { key: 'coreAverage' as const, title: 'جودة المحادثات /10', unit: '', domain: [0, 10] as [number, number] }].map(m => <div key={m.key}>
              <div dir="rtl" className="mb-1 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{m.title}</div>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={quality} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke={c.grid} vertical={false} />
                  <XAxis dataKey="name" reversed tick={axis} tickLine={false} axisLine={{ stroke: c.grid }} />
                  <YAxis orientation="right" tick={axis} tickLine={false} axisLine={false} width={34} domain={m.domain} unit={m.unit} />
                  {m.key === 'coreAverage' ? <ReferenceLine y={7} stroke={c.muted} label={{ value: 'المعيار', position: 'insideTopLeft', fill: c.muted, fontSize: 10 }} /> : <ReferenceLine y={20} stroke={c.muted} label={{ value: 'حد التكرار', position: 'insideTopLeft', fill: c.muted, fontSize: 10 }} />}
                  <Tooltip cursor={{ stroke: c.grid }} content={({ active, payload }) => active && payload?.[0] ? (() => { const q = payload[0].payload as typeof quality[number]; return <TipBox title={`دورة ${q.name}`} lines={[q.lateDays === null ? 'الحضور غير متاح' : `تأخير ${n0(q.lateDays)} من ${n0(q.workedDays || 0)} يوم حضور`, q.coreAverage === null ? `جودة المحادثات: عينة غير كافية (${n0(q.reviews)})` : `جودة المحادثات ${n1(q.coreAverage)}/10 على ${n0(q.reviews)} مراجعة`, q.medicalErrors > 0 && `أخطاء طبية/حرجة موثقة: ${n0(q.medicalErrors)}`]} />; })() : null} />
                  <Line type="linear" dataKey={m.key} stroke={c.primary} strokeWidth={2} dot={{ r: 4, fill: c.primary, stroke: c.surface, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>)}
          </div>) : null}
    </div>
  </section>;
}
