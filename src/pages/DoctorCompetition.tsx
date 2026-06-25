import { useEffect, useMemo, useState } from 'react';
import { Medal, RefreshCw, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

type DoctorScore = { name: string; branch: string; sales: number; invoices: number; avgInvoice: number; listItems: number; stagnantItems: number };
function currentCycle() { const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), 26); if (now.getDate() < 26) start.setMonth(start.getMonth() - 1); const end = new Date(start); end.setMonth(end.getMonth() + 1); end.setDate(25); return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }; }
function num(value: unknown) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function money(value: number) { return value.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) + ' ج'; }

export default function DoctorCompetition() {
  const { user } = useAuth();
  const [rows, setRows] = useState<DoctorScore[]>([]);
  const [loading, setLoading] = useState(true);
  const cycle = useMemo(currentCycle, []);
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('sales_invoices').select('*').gte('invoice_date', cycle.start).lte('invoice_date', cycle.end).limit(8000);
      const map = new Map<string, DoctorScore>();
      for (const invoice of (data || []) as any[]) {
        const name = String(invoice.seller_name || invoice.doctor_name || invoice.staff_name || invoice.created_by_name || 'غير محدد').trim();
        const branch = String(invoice.branch || 'غير محدد').trim();
        if (user?.branch && user.role !== 'general_manager' && user.role !== 'branches_manager' && branch && branch !== user.branch) continue;
        const key = name + '|' + branch;
        const current = map.get(key) || { name, branch, sales: 0, invoices: 0, avgInvoice: 0, listItems: 0, stagnantItems: 0 };
        current.sales += num(invoice.net_total || invoice.total || invoice.amount || invoice.invoice_total);
        current.invoices += 1;
        if (invoice.is_list_item || invoice.list_item || invoice.incentive_item) current.listItems += 1;
        if (invoice.is_stagnant || invoice.stagnant_item || invoice.slow_moving) current.stagnantItems += 1;
        map.set(key, current);
      }
      setRows([...map.values()].map((row) => ({ ...row, avgInvoice: row.invoices ? row.sales / row.invoices : 0 })).sort((a, b) => b.sales - a.sales));
    } catch (error) { console.warn('[DoctorCompetition] failed', error); setRows([]); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const topSales = rows[0];
  const topList = [...rows].sort((a, b) => b.listItems - a.listItems)[0];
  const topStagnant = [...rows].sort((a, b) => b.stagnantItems - a.stagnantItems)[0];
  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-amber-400/30 bg-gradient-to-l from-amber-950/30 via-slate-950 to-slate-900 p-5 text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-black text-white">مسابقة الدكاترة</h1><p className="mt-2 text-sm text-slate-300">ترتيب يومي وشهري لتحفيز الفريق على المبيعات، اللستة، الرواكد وخدمة العملاء.</p><p className="mt-1 text-xs text-amber-200">دورة التقييم الحالية: {cycle.start} إلى {cycle.end}</p></div><button className="btn-primary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'ml-1 inline h-4 w-4 animate-spin' : 'ml-1 inline h-4 w-4'} /> تحديث</button></div>
      </section>
      <section className="grid gap-3 md:grid-cols-3"><Winner title="بطل المبيعات" row={topSales} value={topSales ? money(topSales.sales) : 'لا يوجد'} /><Winner title="بطل اللستة" row={topList} value={topList ? String(topList.listItems) : '0'} /><Winner title="بطل الرواكد" row={topStagnant} value={topStagnant ? String(topStagnant.stagnantItems) : '0'} /></section>
      <section className="dawaa-panel overflow-x-auto"><table className="min-w-full text-sm"><thead className="text-slate-400"><tr><th className="p-3 text-right">#</th><th className="p-3 text-right">الدكتور</th><th className="p-3 text-right">الفرع</th><th className="p-3 text-right">المبيعات</th><th className="p-3 text-right">الفواتير</th><th className="p-3 text-right">متوسط الفاتورة</th><th className="p-3 text-right">اللستة</th><th className="p-3 text-right">الرواكد</th></tr></thead><tbody>{rows.map((row, index) => (<tr key={row.name + row.branch} className="border-t border-slate-800 text-slate-200"><td className="p-3 font-black">{index + 1}</td><td className="p-3 font-black text-white">{row.name}</td><td className="p-3">{row.branch}</td><td className="p-3">{money(row.sales)}</td><td className="p-3">{row.invoices}</td><td className="p-3">{money(row.avgInvoice)}</td><td className="p-3">{row.listItems}</td><td className="p-3">{row.stagnantItems}</td></tr>))}</tbody></table>{!loading && !rows.length && <div className="p-10 text-center text-slate-400">لا توجد بيانات مبيعات متاحة للفترة الحالية.</div>}</section>
    </div>
  );
}
function Winner({ title, row, value }: { title: string; row?: DoctorScore; value: string }) { return <div className="rounded-3xl border border-amber-400/30 bg-amber-500/10 p-5"><div className="flex items-center gap-2 text-amber-200"><Trophy className="h-5 w-5" /> {title}</div><div className="mt-3 text-2xl font-black text-white">{row?.name || 'لا يوجد'}</div><div className="mt-1 text-sm text-slate-300">{row?.branch || ''}</div><div className="mt-3 inline-flex rounded-full bg-amber-400/15 px-3 py-1 text-sm font-black text-amber-100"><Medal className="ml-1 h-4 w-4" /> {value}</div></div>; }
