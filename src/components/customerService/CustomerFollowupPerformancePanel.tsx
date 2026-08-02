import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

type DailyRow = {
  date: string;
  total: number;
  contacted: number;
  responded: number;
  noAnswer: number;
  completed: number;
  scheduled: number;
  purchased: number;
  purchaseValue: number;
};

type PerformanceData = {
  branch: string;
  from: string;
  to: string;
  summary: Omit<DailyRow, 'date'>;
  daily: DailyRow[];
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const shiftDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const cycleStart = () => {
  const d = new Date();
  if (d.getDate() < 26) d.setMonth(d.getMonth() - 1);
  d.setDate(26);
  return d.toISOString().slice(0, 10);
};

const EMPTY = { total: 0, contacted: 0, responded: 0, noAnswer: 0, completed: 0, scheduled: 0, purchased: 0, purchaseValue: 0 };

export default function CustomerFollowupPerformancePanel() {
  const { user } = useAuth();
  const stored = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('dawaa-followup-performance-filters') || '{}'); } catch { return {}; }
  }, []);
  const [branch, setBranch] = useState<string>(stored.branch || 'كل الفروع');
  const [from, setFrom] = useState<string>(stored.from || todayIso());
  const [to, setTo] = useState<string>(stored.to || todayIso());
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(false);

  const actorId = String(user?.id || user?.staffId || user?.username || '');

  async function load() {
    if (!actorId) return;
    setLoading(true);
    try {
      const { data: result, error } = await supabase.rpc('customer_followup_performance_v1', {
        p_actor_id: actorId,
        p_branch: branch,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      setData(result as PerformanceData);
      localStorage.setItem('dawaa-followup-performance-filters', JSON.stringify({ branch, from, to }));
    } catch (error) {
      toast.error(`تعذر تحميل أداء المتابعات: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [actorId, branch, from, to]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('dataChanged', refresh);
    return () => window.removeEventListener('dataChanged', refresh);
  });

  const summary = data?.summary || EMPTY;
  const presets = [
    ['اليوم', todayIso(), todayIso()],
    ['أمس', shiftDays(-1), shiftDays(-1)],
    ['آخر 7 أيام', shiftDays(-6), todayIso()],
    ['الشهر الحالي', `${todayIso().slice(0, 8)}01`, todayIso()],
    ['دورة 26–25', cycleStart(), todayIso()],
  ];

  return (
    <section className="rounded-3xl border border-teal-400/30 bg-[#102943] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xl font-black text-white"><BarChart3 size={21} className="text-teal-300" /> أداء متابعات خدمة العملاء</div>
          <p className="mt-1 text-sm font-bold text-slate-300">فلتر ثابت بالفرع وتاريخ تنفيذ التواصل، لمعرفة عدد المتابعات يوميًا وخلال الشهر.</p>
        </div>
        <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {presets.map(([label, start, end]) => (
          <button key={label} type="button" className="rounded-xl border border-teal-400/35 px-3 py-2 text-sm font-black text-teal-100 hover:bg-teal-500/10" onClick={() => { setFrom(start); setTo(end); }}>{label}</button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-sm font-black text-slate-200">الفرع
          <select className="mt-1 w-full rounded-xl border border-white/15 bg-[#0a1d32] px-3 py-3 text-white" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option>كل الفروع</option><option>فرع الشامي</option><option>فرع شكري</option>
          </select>
        </label>
        <label className="text-sm font-black text-slate-200">من
          <input type="date" className="mt-1 w-full rounded-xl border border-white/15 bg-[#0a1d32] px-3 py-3 text-white" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm font-black text-slate-200">إلى
          <input type="date" className="mt-1 w-full rounded-xl border border-white/15 bg-[#0a1d32] px-3 py-3 text-white" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {[
          ['إجمالي السجلات', summary.total], ['تم التواصل', summary.contacted], ['تم الرد', summary.responded], ['لم يرد', summary.noAnswer],
          ['مكتمل', summary.completed], ['متابعة قادمة', summary.scheduled], ['شراء بعد المتابعة', summary.purchased], ['قيمة الشراء', `${Number(summary.purchaseValue || 0).toLocaleString('ar-EG')} ج`],
        ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center"><div className="text-xs font-bold text-slate-400">{label}</div><div className="mt-1 text-xl font-black text-white">{value}</div></div>)}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-[#0a1d32] text-slate-200"><tr>{['التاريخ','الإجمالي','تم التواصل','تم الرد','لم يرد','مكتمل','متابعة قادمة','شراء'].map((h) => <th key={h} className="px-3 py-3 text-center font-black">{h}</th>)}</tr></thead>
          <tbody>
            {(data?.daily || []).map((row) => (
              <tr key={row.date} className="border-t border-white/10 text-white">
                <td className="px-3 py-3 text-center font-black"><CalendarDays size={15} className="ml-1 inline text-teal-300" />{row.date}</td>
                {[row.total,row.contacted,row.responded,row.noAnswer,row.completed,row.scheduled,row.purchased].map((v, i) => <td key={i} className="px-3 py-3 text-center font-bold">{v}</td>)}
              </tr>
            ))}
            {!loading && !(data?.daily || []).length ? <tr><td colSpan={8} className="px-4 py-8 text-center font-bold text-slate-400">لا توجد متابعات في الفترة المحددة</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
