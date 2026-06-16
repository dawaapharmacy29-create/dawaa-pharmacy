import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Wallet, Clock, Star, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";

type PayrollRow = { username?: string | null; staff_name?: string | null; role?: string | null; branch?: string | null; base_salary?: number | null; hourly_rate?: number | null; worked_hours?: number | null; overtime_hours?: number | null; target_bonus?: number | null; quarterly_bonus?: number | null; incentives_total?: number | null; deductions_total?: number | null; calculated_net_salary?: number | null; status?: string | null; payroll_month?: string | null };
function n(v: unknown) { const x = Number(v || 0); return Number.isFinite(x) ? x : 0; }

export default function StaffPayroll() {
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data, error } = await supabase.from("dawaa_staff_payroll_summary_v13").select("*").order("staff_name").limit(300);
      if (error) throw error;
      setRows((data || []) as PayrollRow[]);
    } catch (err) { setError(err instanceof Error ? err.message : "تعذر تحميل القبض"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const totals = rows.reduce((acc, r) => ({ net: acc.net + n(r.calculated_net_salary), base: acc.base + n(r.base_salary), incentives: acc.incentives + n(r.incentives_total) + n(r.target_bonus) + n(r.quarterly_bonus), deductions: acc.deductions + n(r.deductions_total) }), { net: 0, base: 0, incentives: 0, deductions: 0 });
  return <div className="space-y-5" dir="rtl">
    <div className="rounded-2xl border border-[#E5EAF0] bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h1 className="text-2xl font-black text-slate-900">تفاصيل قبض الموظفين V13</h1><p className="mt-1 text-sm font-bold text-slate-500">الأساسي، ساعات العمل، الحافز، التارجت، الحافز الربع سنوي، الخصومات، والصافي.</p></div><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-700"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/> تحديث</button></div></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
    <div className="grid gap-3 md:grid-cols-4"><Card title="إجمالي الصافي" value={formatCurrency(totals.net)} icon={Wallet}/><Card title="إجمالي الأساسي" value={formatCurrency(totals.base)} icon={Clock}/><Card title="الحوافز" value={formatCurrency(totals.incentives)} icon={Star}/><Card title="الخصومات" value={formatCurrency(totals.deductions)} icon={TrendingUp}/></div>
    <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm"><h2 className="mb-3 text-lg font-black text-slate-900">قائمة القبض</h2><div className="overflow-auto"><table className="min-w-full text-sm"><thead><tr className="bg-slate-50 text-slate-600"><th className="p-3 text-right">الموظف</th><th className="p-3 text-right">الدور</th><th className="p-3 text-right">الفرع</th><th className="p-3 text-right">الأساسي</th><th className="p-3 text-right">الساعات</th><th className="p-3 text-right">حافز التارجت</th><th className="p-3 text-right">ربع سنوي</th><th className="p-3 text-right">خصومات</th><th className="p-3 text-right">الصافي</th></tr></thead><tbody>{rows.map((r, i) => <tr key={`${r.username}-${i}`} className="border-t"><td className="p-3 font-black">{r.staff_name || r.username || "-"}</td><td className="p-3">{r.role || "-"}</td><td className="p-3">{r.branch || "-"}</td><td className="p-3">{formatCurrency(n(r.base_salary))}</td><td className="p-3">{n(r.worked_hours).toLocaleString("ar-EG")}</td><td className="p-3">{formatCurrency(n(r.target_bonus))}</td><td className="p-3">{formatCurrency(n(r.quarterly_bonus))}</td><td className="p-3">{formatCurrency(n(r.deductions_total))}</td><td className="p-3 font-black text-teal-700">{formatCurrency(n(r.calculated_net_salary))}</td></tr>)}</tbody></table></div>{!rows.length && <div className="rounded-xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">لم يتم إدخال ملفات قبض بعد. استخدم staff_payroll_profiles_v13 و staff_payroll_monthly_v13.</div>}</div>
  </div>;
}
function Card({ title, value, icon: Icon }: { title: string; value: string; icon: any }) { return <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><div className="text-xs font-bold text-slate-500">{title}</div><div className="mt-2 text-2xl font-black text-slate-900">{value}</div></div><span className="rounded-2xl bg-teal-50 p-3 text-teal-700"><Icon size={20}/></span></div></div>; }
