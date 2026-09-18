import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock3, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { classifySampleQuality, summarizeResponseMetrics } from '@/lib/whatsappDeepConversationIntelligenceV26';

type TurnRow = {
  staff_id: string | null;
  staff_name: string | null;
  branch: string | null;
  response_latency_seconds: number | null;
  no_response: boolean | null;
  inbound_ended_at: string | null;
};

type SourceRow = {
  id: string;
  branch: string | null;
  staff_id: string | null;
  staff_name: string | null;
  commercial_eligible: boolean | null;
  review_status: string | null;
  analysis_json: any;
  conversation_started_at: string | null;
};

function cairoCycleStart() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  let year = Number(parts.find((x) => x.type === 'year')?.value || 0);
  let month = Number(parts.find((x) => x.type === 'month')?.value || 0);
  const day = Number(parts.find((x) => x.type === 'day')?.value || 0);
  if (day < 26) { month -= 1; if (month === 0) { month = 12; year -= 1; } }
  return `${year}-${String(month).padStart(2, '0')}-26`;
}

function sec(value: number | null) {
  if (value == null) return '—';
  if (value < 60) return `${value} ث`;
  return `${Math.round(value / 60)} د`;
}

export default function WhatsAppDeepConversationIntelligenceV26() {
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const cycleStart = cairoCycleStart();

  const load = async () => {
    setLoading(true);
    try {
      const [turnRes, sourceRes] = await Promise.all([
        supabase.from('whatsapp_response_turns_v18').select('staff_id,staff_name,branch,response_latency_seconds,no_response,inbound_ended_at').gte('inbound_ended_at', `${cycleStart}T00:00:00`).limit(5000),
        supabase.from('whatsapp_review_sources').select('id,branch,staff_id,staff_name,commercial_eligible,review_status,analysis_json,conversation_started_at').gte('conversation_started_at', `${cycleStart}T00:00:00`).limit(3000),
      ]);
      if (turnRes.error) throw turnRes.error;
      if (sourceRes.error) throw sourceRes.error;
      setTurns((turnRes.data || []) as TurnRow[]);
      setSources((sourceRes.data || []) as SourceRow[]);
    } catch (error) {
      console.warn('[whatsapp-v26] load failed', error);
      setTurns([]); setSources([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const response = useMemo(() => summarizeResponseMetrics(turns), [turns]);
  const eligible = sources.filter((x) => x.commercial_eligible).length;
  const sample = classifySampleQuality(eligible);
  const mandatoryHuman = sources.filter((x) => ['ready_detailed', 'needs_context'].includes(String(x.review_status || ''))).length;
  const medicalFlagged = sources.filter((x) => Array.isArray(x.analysis_json?.medicalSafetyFlags) && x.analysis_json.medicalSafetyFlags.length > 0).length;

  const doctorRows = useMemo(() => {
    const map = new Map<string, { name: string; branch: string; turns: TurnRow[]; eligible: number; total: number }>();
    sources.forEach((row) => {
      const key = `${row.staff_id || row.staff_name || 'unknown'}::${row.branch || ''}`;
      const current = map.get(key) || { name: row.staff_name || 'غير محدد', branch: row.branch || '—', turns: [], eligible: 0, total: 0 };
      current.total += 1;
      if (row.commercial_eligible) current.eligible += 1;
      map.set(key, current);
    });
    turns.forEach((row) => {
      const key = `${row.staff_id || row.staff_name || 'unknown'}::${row.branch || ''}`;
      const current = map.get(key) || { name: row.staff_name || 'غير محدد', branch: row.branch || '—', turns: [], eligible: 0, total: 0 };
      current.turns.push(row);
      map.set(key, current);
    });
    return [...map.values()].map((row) => ({ ...row, metrics: summarizeResponseMetrics(row.turns), sample: classifySampleQuality(row.eligible) }))
      .sort((a, b) => (b.metrics.p90Seconds || 0) - (a.metrics.p90Seconds || 0));
  }, [turns, sources]);

  return <section className="dawaa-card dawaa-card--raised p-4" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-xs font-black text-cyan-200">Conversation Deep Intelligence V26</div><div className="mt-1 text-xl font-black text-white">سرعة الرد + جودة العينة + إشارات المراجعة العميقة</div><div className="mt-1 text-xs leading-6 text-slate-400">يعتمد على Response Turns الحقيقية داخل السايكل 26→25، مع فصل واضح بين جودة العينة وعدد الحالات التي تحتاج مراجعة بشرية.</div></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs font-black text-slate-200 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'ml-1 inline animate-spin' : 'ml-1 inline'} /> تحديث</button>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
      <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><Clock3 size={15} className="mb-2 text-cyan-300"/><div className="text-[11px] text-slate-500">متوسط الرد</div><div className="font-black text-white">{sec(response.averageSeconds)}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><Activity size={15} className="mb-2 text-violet-300"/><div className="text-[11px] text-slate-500">P90</div><div className="font-black text-white">{sec(response.p90Seconds)}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><Activity size={15} className="mb-2 text-amber-300"/><div className="text-[11px] text-slate-500">P95</div><div className="font-black text-white">{sec(response.p95Seconds)}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><AlertTriangle size={15} className="mb-2 text-rose-300"/><div className="text-[11px] text-slate-500">بدون رد</div><div className="font-black text-white">{response.unanswered}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><ShieldCheck size={15} className="mb-2 text-emerald-300"/><div className="text-[11px] text-slate-500">مراجعة بشرية</div><div className="font-black text-white">{mandatoryHuman}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-3"><Users size={15} className="mb-2 text-sky-300"/><div className="text-[11px] text-slate-500">جودة عينة البيع</div><div className="font-black text-white">{sample.label}</div></div>
    </div>

    <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">Medical flags في السايكل: {medicalFlagged}. أي جرعات/أطفال/حمل/رضاعة/حساسية/Red Flags تظل خارج الاعتماد الطبي الآلي وتحتاج مراجعة بشرية.</div>

    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
      <table className="min-w-[980px] w-full text-right text-xs"><thead className="bg-slate-950/70 text-slate-400"><tr><th className="p-3">الدكتور</th><th className="p-3">الفرع</th><th className="p-3">المحادثات</th><th className="p-3">عينة البيع</th><th className="p-3">جودة العينة</th><th className="p-3">Avg</th><th className="p-3">P90</th><th className="p-3">P95</th><th className="p-3">+10 د</th><th className="p-3">بدون رد</th></tr></thead>
      <tbody>{doctorRows.map((row) => <tr key={`${row.name}:${row.branch}`} className="border-t border-slate-800 text-slate-200"><td className="p-3 font-black text-white">{row.name}</td><td className="p-3">{row.branch}</td><td className="p-3">{row.total}</td><td className="p-3">{row.eligible}</td><td className="p-3 text-cyan-200">{row.sample.label}</td><td className="p-3">{sec(row.metrics.averageSeconds)}</td><td className="p-3">{sec(row.metrics.p90Seconds)}</td><td className="p-3">{sec(row.metrics.p95Seconds)}</td><td className="p-3 text-amber-200">{row.metrics.over10Minutes}</td><td className="p-3 text-rose-200">{row.metrics.unanswered}</td></tr>)}</tbody></table>
      {!doctorRows.length && !loading ? <div className="p-8 text-center text-sm text-slate-500">لا توجد بيانات Response Turns كافية في السايكل الحالي.</div> : null}
    </div>
  </section>;
}
