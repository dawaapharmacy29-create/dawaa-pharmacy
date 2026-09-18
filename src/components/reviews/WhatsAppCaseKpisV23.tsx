import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Mode = 'doctors' | 'service';

type DoctorRow = {
  owner_account_id: string;
  owner_name: string | null;
  owner_role: string | null;
  branch: string | null;
  cycle_start: string;
  cycle_end: string;
  handled_cases: number;
  commercial_opportunities: number;
  recommendation_cases: number;
  confirmed_orders: number;
  verified_sales: number;
  verified_conversion_rate: number | null;
  verified_revenue: number;
  lost_opportunities: number;
  cases_with_failure_signal: number;
  cases_with_complaint_signal: number;
};

type ServiceRow = {
  owner_account_id: string;
  owner_name: string | null;
  owner_role: string | null;
  branch: string | null;
  cycle_start: string;
  cycle_end: string;
  handled_cases: number;
  recovery_cases: number;
  reengaged_cases: number;
  recovered_verified_sales: number;
  recovered_verified_revenue: number;
  complaint_cases: number;
  resolved_complaints: number;
};

function cairoParts() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((x) => x.type === type)?.value || 0);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function cycleStart() {
  let { year, month, day } = cairoParts();
  if (day < 26) {
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return `${year}-${String(month).padStart(2, '0')}-26`;
}

function n(value: unknown) { return Number(value || 0); }

export default function WhatsAppCaseKpisV23({ mode }: { mode: Mode }) {
  const [doctorRows, setDoctorRows] = useState<DoctorRow[]>([]);
  const [serviceRows, setServiceRows] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const cycle = cycleStart();

  const load = async () => {
    setLoading(true);
    try {
      if (mode === 'doctors') {
        const { data, error } = await supabase
          .from('whatsapp_case_doctor_kpis_v23')
          .select('*')
          .eq('cycle_start', cycle)
          .order('verified_revenue', { ascending: false });
        if (error) throw error;
        setDoctorRows((data || []) as DoctorRow[]);
      } else {
        const { data, error } = await supabase
          .from('whatsapp_case_service_kpis_v23')
          .select('*')
          .eq('cycle_start', cycle)
          .order('recovered_verified_revenue', { ascending: false });
        if (error) throw error;
        setServiceRows((data || []) as ServiceRow[]);
      }
    } catch (error) {
      console.warn('[whatsapp-case-kpis-v23] load failed', mode, error);
      if (mode === 'doctors') setDoctorRows([]); else setServiceRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [mode]);
  const rows = mode === 'doctors' ? doctorRows : serviceRows;

  return (
    <section className="dawaa-card dawaa-card--raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-violet-200">Case KPIs V23 — دورة 26→25</div>
          <div className="mt-1 text-xl font-black text-white">{mode === 'doctors' ? 'Conversion موثق لكل دكتور' : 'Recovery وخدمة العملاء الموثقة'}</div>
          <div className="mt-1 text-xs leading-6 text-slate-400">{mode === 'doctors' ? 'النسبة مبنية على Commercial Cases وفواتير مؤكدة، وليس مجرد كلمات بيع داخل المحادثة.' : 'يتم فصل محاولة المتابعة عن إعادة التفاعل وعن البيع المسترجع المؤكد بالفاتورة.'}</div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs font-black text-slate-200 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'ml-1 inline animate-spin' : 'ml-1 inline'} /> تحديث
        </button>
      </div>

      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs text-slate-400">الدورة الحالية تبدأ {cycle}. لو مفيش بيانات يظهر صفر بدل عرض دورة قديمة كأنها الحالية.</div>

      {rows.length ? (
        <div className="mt-4 overflow-x-auto">
          {mode === 'doctors' ? (
            <table className="min-w-[1050px] w-full text-right text-xs">
              <thead className="text-slate-400"><tr><th className="p-2">الدكتور</th><th className="p-2">الفرع</th><th className="p-2">Cases</th><th className="p-2">فرص</th><th className="p-2">ترشيحات</th><th className="p-2">أوردرات مؤكدة</th><th className="p-2">مبيعات مؤكدة</th><th className="p-2">Conversion</th><th className="p-2">الإيراد المؤكد</th><th className="p-2">Lost</th><th className="p-2">تعثر</th></tr></thead>
              <tbody>{doctorRows.map((row) => <tr key={`${row.owner_account_id}:${row.branch || ''}`} className="border-t border-slate-800/80"><td className="p-2 font-black text-white">{row.owner_name || 'غير محدد'}</td><td className="p-2 text-slate-400">{row.branch || '-'}</td><td className="p-2">{n(row.handled_cases)}</td><td className="p-2 text-cyan-200">{n(row.commercial_opportunities)}</td><td className="p-2">{n(row.recommendation_cases)}</td><td className="p-2">{n(row.confirmed_orders)}</td><td className="p-2 text-emerald-200">{n(row.verified_sales)}</td><td className="p-2 font-black text-violet-200">{row.verified_conversion_rate == null ? '—' : `${n(row.verified_conversion_rate).toLocaleString('ar-EG')}%`}</td><td className="p-2 text-emerald-300">{n(row.verified_revenue).toLocaleString('ar-EG')} ج</td><td className="p-2 text-rose-200">{n(row.lost_opportunities)}</td><td className="p-2 text-amber-200">{n(row.cases_with_failure_signal)}</td></tr>)}</tbody>
            </table>
          ) : (
            <table className="min-w-[900px] w-full text-right text-xs">
              <thead className="text-slate-400"><tr><th className="p-2">مسئول المتابعة</th><th className="p-2">الفرع</th><th className="p-2">Cases</th><th className="p-2">Recovery</th><th className="p-2">عاد للتفاعل</th><th className="p-2">بيع مسترجع مؤكد</th><th className="p-2">قيمة مسترجعة</th><th className="p-2">شكاوى</th><th className="p-2">شكاوى محلولة</th></tr></thead>
              <tbody>{serviceRows.map((row) => <tr key={`${row.owner_account_id}:${row.branch || ''}`} className="border-t border-slate-800/80"><td className="p-2 font-black text-white">{row.owner_name || 'غير محدد'}</td><td className="p-2 text-slate-400">{row.branch || '-'}</td><td className="p-2">{n(row.handled_cases)}</td><td className="p-2 text-violet-200">{n(row.recovery_cases)}</td><td className="p-2 text-cyan-200">{n(row.reengaged_cases)}</td><td className="p-2 text-emerald-200">{n(row.recovered_verified_sales)}</td><td className="p-2 text-emerald-300">{n(row.recovered_verified_revenue).toLocaleString('ar-EG')} ج</td><td className="p-2 text-amber-200">{n(row.complaint_cases)}</td><td className="p-2">{n(row.resolved_complaints)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      ) : <div className="mt-4 rounded-2xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">لا توجد Case KPIs موثقة في الدورة الحالية حتى الآن.</div>}
    </section>
  );
}
