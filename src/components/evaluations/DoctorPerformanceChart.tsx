import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import type { EyeChartModel, EyeChartTabKey, EyeSourceCellStatus, EyeTrendMetric, EyeTrendMetricKey } from '@/lib/evaluations/doctorEyeChartModel';

const n0 = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
const n1 = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const formatValue = (unit: EyeTrendMetric['unit'], v: number | null) => v === null ? 'غير متاح' : unit === 'money' ? `${n0(v)} ج` : unit === 'pct' ? `${n1(v)}%` : n1(v);

/** SVG attributes cannot read CSS variables, so resolve the theme tokens once per render surface. */
function useThemeColors() {
  const [colors, setColors] = useState({ primary: '#0f766e', muted: '#94a3b8', text: '#334155', grid: '#e2e8f0', surface: '#ffffff' });
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    setColors(c => ({
      primary: read('--dawaa-theme-primary', c.primary),
      muted: read('--dawaa-theme-muted', c.muted),
      text: read('--dawaa-theme-text', c.text),
      grid: read('--dawaa-theme-divider', read('--dawaa-theme-border', c.grid)),
      surface: read('--dawaa-theme-surface', c.surface),
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

function Legend({ items }: { items: { color: string; label: string; swatch?: 'dot' | 'band' | 'diamond' | 'ring' }[] }) {
  return <div dir="rtl" className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
    {items.map(i => <span key={i.label} className="inline-flex items-center gap-1.5">
      <span aria-hidden style={i.swatch === 'band' ? { width: 14, height: 8, borderRadius: 3, background: i.color, opacity: 0.3 } : i.swatch === 'diamond' ? { width: 8, height: 8, background: i.color, transform: 'rotate(45deg)' } : i.swatch === 'ring' ? { width: 9, height: 9, borderRadius: 9, border: `2px solid ${i.color}` } : { width: 9, height: 9, borderRadius: 9, background: i.color }} />{i.label}
    </span>)}
  </div>;
}

function Table({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[360px] text-[11px] font-bold">
    <thead><tr style={{ color: 'var(--dawaa-theme-muted)' }}>{head.map((h, i) => <th key={i} className="p-1.5 text-right font-black">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="border-t tabular-nums" style={{ borderColor: 'var(--dawaa-theme-border)' }}>{r.map((c, j) => <td key={j} className="p-1.5 align-top">{c}</td>)}</tr>)}</tbody>
  </table></div>;
}

const CELL_COLOR: Record<EyeSourceCellStatus, string> = { ok: 'var(--dawaa-status-success-text)', partial: 'var(--dawaa-status-warning-text)', missing: 'var(--dawaa-status-danger-text)', not_applicable: 'var(--dawaa-theme-muted)' };
const toneStyle = (tone: string) => tone === 'neutral'
  ? { color: 'var(--dawaa-theme-muted)', background: 'var(--dawaa-theme-soft)', borderColor: 'var(--dawaa-theme-border)' }
  : { color: `var(--dawaa-status-${tone}-text)`, background: `var(--dawaa-status-${tone}-bg)`, borderColor: `var(--dawaa-status-${tone}-border)` };

const CAPTION: Record<EyeChartTabKey, string> = {
  trend: 'أداء الدكتور نفسه عبر آخر الدورات — من مصادره الموثقة فقط، ولا يعتمد على مقارنة الفرع',
  shifts: 'مبيعات الساعة في كل شيفت مقابل النطاق المعتاد للزملاء في نفس الشيفت',
  peers: 'موقعه بين زملاء الفرع المؤهلين بعد معادلة الشيفتات — المنطقة المظللة = النطاق الأوسط (25%–75%)',
  sources: 'ما الذي بُنيت عليه الأرقام في كل دورة — غير متاح لا يعني صفرًا',
};

/** One interactive chart with four tabs. An unavailable tab explains why; it never hides the other tabs. */
export default function DoctorPerformanceChart({ model }: { model: EyeChartModel }) {
  const [tab, setTab] = useState<EyeChartTabKey>(model.defaultTab);
  const [metricKey, setMetricKey] = useState<EyeTrendMetricKey | null>(model.trend.defaultMetric);
  const [asTable, setAsTable] = useState(false);
  const c = useThemeColors();
  const axis = { fontSize: 11, fill: c.muted };
  const active = model.tabs.find(t => t.key === tab) || model.tabs[0];
  const metric = model.trend.metrics.find(m => m.key === metricKey) || null;
  const trendRows = useMemo(() => (metric ? metric.points.map(p => ({ ...p, solid: p.running ? null : p.value, open: p.running ? p.value : null })) : []), [metric]);
  const peers = useMemo(() => model.peers.points.map(p => ({ ...p, pct: Math.round(p.index * 100), y: 1 })), [model]);
  const band = model.peers.band;
  const shifts = useMemo(() => model.shifts.map(s => ({ ...s, bandStart: s.p25 ?? 0, bandSize: s.p25 !== null && s.p75 !== null ? s.p75 - s.p25 : 0 })), [model]);
  const notes = metric ? metric.points.filter(p => p.note && (p.value === null || p.running)) : [];

  return <section className="rounded-2xl border p-3 sm:p-4" style={{ borderColor: 'var(--dawaa-theme-border)' }} data-testid="doctor-performance-chart">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="tablist" aria-label="نوع التحليل" className="flex max-w-full flex-wrap rounded-xl border p-0.5" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
        {model.tabs.map(t => <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)} title={t.reason || undefined} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-black sm:px-3 sm:text-[12px]" style={tab === t.key ? { background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-heading)', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: 'var(--dawaa-theme-muted)' }}>
          {t.label}{!t.available ? <span aria-label="غير متاح" style={{ width: 6, height: 6, borderRadius: 6, background: t.state === 'failed' ? 'var(--dawaa-status-danger-text)' : 'var(--dawaa-theme-muted)' }} /> : null}
        </button>)}
      </div>
      {active.available && tab !== 'sources' ? <button type="button" onClick={() => setAsTable(v => !v)} className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>{asTable ? 'عرض كرسم' : 'عرض كجدول'}</button> : null}
    </div>
    <p className="mt-2 text-[11px] font-bold leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>{CAPTION[tab]}</p>

    {!active.available ? <div className="mt-2 flex min-h-[140px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-6 text-center text-[12px] font-bold leading-6" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }} data-testid={`chart-tab-unavailable-${tab}`}>
      <span className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{active.state === 'loading' ? 'جاري التحميل' : active.state === 'not_enabled' ? 'لم يُفعَّل بعد' : active.state === 'failed' ? 'تعذر التحميل' : 'بيانات غير كافية'}</span>
      <span>{active.reason}</span>
      {tab !== 'trend' && model.tabs[0].available ? <button type="button" onClick={() => setTab('trend')} className="mt-1 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>عرض تطور أداء الدكتور ←</button> : null}
    </div> : null}

    {tab === 'trend' && active.available && metric ? <div className="mt-2">
      <div className="mb-2 flex flex-wrap gap-1" role="radiogroup" aria-label="المؤشر">
        {model.trend.metrics.map(m => <button key={m.key} type="button" role="radio" aria-checked={metricKey === m.key} disabled={!m.available} title={m.reason || m.definition} onClick={() => setMetricKey(m.key)} className="rounded-full border px-2.5 py-1 text-[11px] font-black disabled:cursor-not-allowed disabled:opacity-45" style={metricKey === m.key ? { borderColor: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-strong)', background: 'var(--dawaa-theme-soft)' } : { borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}>{m.label}</button>)}
      </div>
      {asTable ? <Table head={['المؤشر', ...model.cycles.map(cy => `${cy.name}${cy.running ? ' (جارية)' : ''}`)]} rows={model.trend.metrics.map(m => [m.label, ...m.points.map(p => <span key={p.cycleLabel} title={p.note || undefined} style={p.value === null ? { color: 'var(--dawaa-theme-muted)' } : undefined}>{formatValue(m.unit, p.value)}</span>)])} />
      : <div dir="ltr"><ResponsiveContainer width="100%" height={210}>
          <LineChart data={trendRows} margin={{ top: 12, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="name" reversed tick={axis} tickLine={false} axisLine={{ stroke: c.grid }} />
            <YAxis orientation="right" tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => metric.unit === 'pct' ? `${n0(v)}%` : n0(v)} domain={metric.unit === 'pct' ? [0, (max: number) => Math.min(100, Math.max(20, Math.ceil(max / 10) * 10))] : [0, 'auto']} />
            <Tooltip cursor={{ stroke: c.grid }} content={({ active: on, payload }) => on && payload?.[0] ? (() => { const p = payload[0].payload as typeof trendRows[number]; return <TipBox title={`دورة ${p.name}${p.running ? ' (جارية)' : ''}`} lines={[`${metric.label}: ${formatValue(metric.unit, p.value)}`, p.note]} />; })() : null} />
            <Line type="linear" dataKey="value" stroke={c.primary} strokeWidth={2} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Line type="linear" dataKey="solid" stroke="transparent" dot={{ r: 4, fill: c.primary, stroke: c.surface, strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
            <Line type="linear" dataKey="open" stroke="transparent" dot={{ r: 4, fill: c.surface, stroke: c.primary, strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <Legend items={[{ color: c.primary, label: 'دورة مكتملة' }, { color: c.primary, label: 'دورة جارية (حتى آخر يوم محمّل)', swatch: 'ring' }]} />
      </div>}
      <div className="mt-1 text-[11px] font-bold leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>
        <div>طريقة الحساب: {metric.definition}</div>
        {notes.map(p => <div key={p.cycleLabel}>• {p.name}: {p.note}</div>)}
      </div>
    </div> : null}

    {tab === 'peers' && active.available && band ? <div className="mt-2">
      {asTable ? <Table head={['', 'الإنتاجية المعدلة', 'ساعات']} rows={[...peers].sort((a, b) => b.pct - a.pct).map(p => [p.isTarget ? <b key="t">{p.label}</b> : p.label, `${n0(p.pct)}%`, n0(p.hours)])} />
      : <div dir="ltr"><ResponsiveContainer width="100%" height={150}>
          <ScatterChart margin={{ top: 22, right: 16, bottom: 4, left: 16 }}>
            <CartesianGrid stroke={c.grid} vertical horizontal={false} />
            <XAxis type="number" dataKey="pct" reversed tick={axis} tickLine={false} axisLine={{ stroke: c.grid }} unit="%" domain={[(min: number) => Math.floor(Math.min(min, band.p25 * 100) / 10) * 10 - 10, (max: number) => Math.ceil(Math.max(max, band.p75 * 100) / 10) * 10 + 10]} />
            <YAxis type="number" dataKey="y" hide domain={[0, 2]} />
            <ZAxis range={[90, 90]} />
            <ReferenceArea x1={Math.round(band.p25 * 100)} x2={Math.round(band.p75 * 100)} y1={0} y2={2} fill={c.muted} fillOpacity={0.12} stroke="none" />
            <ReferenceLine x={Math.round(band.median * 100)} stroke={c.muted} label={{ value: 'الوسيط', position: 'top', fill: c.muted, fontSize: 10 }} />
            <Tooltip cursor={false} content={({ active: on, payload }) => on && payload?.[0] ? (() => { const p = payload[0].payload as typeof peers[number]; return <TipBox title={p.label} lines={[`الإنتاجية المعدلة ${n0(p.pct)}%`, `${n0(p.hours)} ساعة حضور في الدورة`, p.isTarget ? `الوسيط ${n0(band.median * 100)}%، النطاق ${n0(band.p25 * 100)}–${n0(band.p75 * 100)}%` : 'هوية الزميل مخفية؛ المقارنة على نفس قواعد الأهلية']} />; })() : null} />
            <Scatter data={peers.filter(p => !p.isTarget)} fill={c.muted} fillOpacity={0.55} isAnimationActive={false} />
            <Scatter data={peers.filter(p => p.isTarget)} fill={c.primary} stroke={c.surface} strokeWidth={2} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
        <Legend items={[{ color: c.primary, label: peers.find(p => p.isTarget)?.label || 'الدكتور' }, { color: c.muted, label: 'زميل مؤهل' }, { color: c.muted, label: 'النطاق الأوسط للزملاء', swatch: 'band' }]} /></div>}
    </div> : null}

    {tab === 'shifts' && active.available ? <div className="mt-2">
      {asTable ? <Table head={['الشيفت', 'مبيعات/ساعة', 'المرجع', 'نطاق الزملاء', 'ساعات', 'الثقة']} rows={shifts.map(s => [s.label, `${n0(s.actual)} ج`, s.expected === null ? 'غير متاح' : `${n0(s.expected)} ج`, s.p25 === null ? 'عينة غير كافية' : `${n0(s.p25)}–${n0(s.p75!)} ج`, n0(s.hours), s.confidence === 'high' ? 'عالية' : s.confidence === 'medium' ? 'متوسطة' : 'منخفضة'])} />
      : <div dir="ltr"><ResponsiveContainer width="100%" height={Math.max(120, shifts.length * 56 + 40)}>
          <ComposedChart layout="vertical" data={shifts} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={c.grid} horizontal={false} />
            <XAxis type="number" reversed tick={axis} tickLine={false} axisLine={{ stroke: c.grid }} tickFormatter={(v: number) => n0(v)} />
            <YAxis type="category" dataKey="label" orientation="right" tick={{ ...axis, fill: c.text }} tickLine={false} axisLine={false} width={56} />
            <Tooltip cursor={{ fill: c.grid, fillOpacity: 0.3 }} content={({ active: on, payload }) => on && payload?.[0] ? (() => { const s = payload[0].payload as typeof shifts[number]; return <TipBox title={`الشيفت ال${s.label}`} lines={[`مبيعات الساعة ${n0(s.actual)} ج على ${n0(s.hours)} ساعة و${n0(s.invoices)} فاتورة`, s.expected !== null && `مرجع الفرع لنفس الشيفت ${n0(s.expected)} ج/ساعة`, s.p25 !== null ? `النطاق المعتاد للزملاء ${n0(s.p25)}–${n0(s.p75!)} ج (${n0(s.peers)} زملاء)` : 'عدد الزملاء في هذا الشيفت غير كافٍ لنطاق موثوق', `الثقة: ${s.confidence === 'high' ? 'عالية' : s.confidence === 'medium' ? 'متوسطة' : 'منخفضة'}`]} />; })() : null} />
            <Bar dataKey="bandStart" stackId="band" fill="transparent" isAnimationActive={false} barSize={14} />
            <Bar dataKey="bandSize" stackId="band" fill={c.muted} fillOpacity={0.22} radius={4} isAnimationActive={false} barSize={14} />
            <Scatter dataKey="expected" fill={c.muted} shape="diamond" isAnimationActive={false} />
            <Scatter dataKey="actual" fill={c.primary} stroke={c.surface} strokeWidth={2} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[{ color: c.primary, label: 'الفعلي' }, { color: c.muted, label: 'مرجع الفرع لنفس الشيفت', swatch: 'diamond' }, { color: c.muted, label: 'النطاق المعتاد للزملاء', swatch: 'band' }]} /></div>}
    </div> : null}

    {tab === 'sources' ? <div className="mt-2">
      <Table head={['المصدر', 'الحالة', ...model.cycles.map(cy => `${cy.name}${cy.running ? ' (جارية)' : ''}`)]} rows={model.sources.map(r => [
        <span key="l" className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{r.label}</span>,
        <span key="s" title={r.reason || undefined} className="inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-black" style={toneStyle(r.tone)}>{r.stateLabel}</span>,
        ...(r.cells ? r.cells.map((cell, i) => <span key={i} style={{ color: CELL_COLOR[cell.status] }}>{cell.text}</span>) : [<span key="all" style={{ color: 'var(--dawaa-theme-muted)' }}>{r.reason || 'نطاق التحليل كاملًا'}</span>, ...model.cycles.slice(1).map((_, i) => <span key={`x${i}`} />)]),
      ])} />
      {model.sources.some(r => r.cells && r.reason) ? <div className="mt-1 space-y-0.5 text-[11px] font-bold leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>{model.sources.filter(r => r.cells && r.reason).map(r => <div key={r.key}>• {r.label}: {r.reason}</div>)}</div> : null}
      <Legend items={[{ color: CELL_COLOR.ok, label: 'مكتمل' }, { color: CELL_COLOR.partial, label: 'جزئي' }, { color: CELL_COLOR.missing, label: 'غير متاح' }, { color: CELL_COLOR.not_applicable, label: 'قبل أول دليل' }]} />
    </div> : null}
  </section>;
}
