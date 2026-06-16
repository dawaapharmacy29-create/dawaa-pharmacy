import { useMemo, useState } from "react";
import { BarChart3, MessageCircle, Star, TrendingUp, Users } from "lucide-react";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { formatCycleDate, getCurrentCycle } from "@/lib/pharmacy-cycle";
import { formatCurrency } from "@/lib/utils";
import { getInvoiceKey } from "@/lib/dawaa2027";

type Row = Record<string, unknown>;

function text(row: Row, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
}

function num(row: Row, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function day(row: Row) {
  return text(row, ["review_date", "conversation_date", "created_at", "date"]).slice(0, 10);
}

export default function WhatsappAnalytics() {
  const cycle = getCurrentCycle();
  const [startDate, setStartDate] = useState(formatCycleDate(cycle.start));
  const [endDate, setEndDate] = useState(formatCycleDate(cycle.end));
  const [branch, setBranch] = useState("الكل");
  const [doctor, setDoctor] = useState("الكل");

  const { data: reviews, loading, error } = useSupabaseQuery<Row>({ table: "conversation_sales_reviews", limit: 3000, realtimeEnabled: true });
  const { data: invoices } = useSupabaseQuery<Row>({ table: "sales_invoices", limit: 5000, realtimeEnabled: false });
  const { data: transactions } = useSupabaseQuery<Row>({ table: "employee_transactions", limit: 2000, realtimeEnabled: true });

  const branches = useMemo(() => Array.from(new Set(reviews.map((row) => text(row, ["branch", "branch_name"])).filter(Boolean))), [reviews]);
  const doctors = useMemo(() => Array.from(new Set(reviews.map((row) => text(row, ["doctor_name", "staff_name", "employee_name", "reviewed_staff_name"])).filter(Boolean))), [reviews]);

  const filtered = useMemo(() => {
    return reviews.filter((row) => {
      const date = day(row);
      if (date && (date < startDate || date > endDate)) return false;
      if (branch !== "الكل" && text(row, ["branch", "branch_name"]) !== branch) return false;
      if (doctor !== "الكل" && text(row, ["doctor_name", "staff_name", "employee_name", "reviewed_staff_name"]) !== doctor) return false;
      return true;
    });
  }, [branch, doctor, endDate, reviews, startDate]);

  const perDoctor = useMemo(() => {
    const map = new Map<string, { name: string; count: number; score: number; weak: number; excellent: number; sales: number; points: number }>();
    for (const row of filtered) {
      const name = text(row, ["doctor_name", "staff_name", "employee_name", "reviewed_staff_name"], "غير محدد");
      const score = num(row, ["score", "total_score", "final_score", "rating"], 0);
      const current = map.get(name) || { name, count: 0, score: 0, weak: 0, excellent: 0, sales: 0, points: 0 };
      current.count += 1;
      current.score += score;
      if (score >= 85) current.excellent += 1;
      if (score > 0 && score < 60) current.weak += 1;
      current.sales += num(row, ["generated_sales", "sales_value", "invoice_amount"], 0);
      current.points += num(row, ["points_delta", "points"], 0);
      map.set(name, current);
    }
    return Array.from(map.values()).map((item) => ({ ...item, avg: item.count ? Math.round(item.score / item.count) : 0 })).sort((a, b) => b.avg - a.avg);
  }, [filtered]);

  const linkedInvoiceSales = useMemo(() => {
    const invoiceNumbers = new Set(filtered.map((row) => text(row, ["invoice_number", "linked_invoice_number"])).filter(Boolean));
    return invoices.filter((invoice) => invoiceNumbers.has(getInvoiceKey(invoice))).reduce((sum, invoice) => sum + num(invoice, ["net_amount", "amount", "total"], 0), 0);
  }, [filtered, invoices]);

  const relatedPoints = useMemo(() => {
    return transactions.filter((row) => String(text(row, ["source", "source_module", "reason", "description"])).includes("conversation")).reduce((sum, row) => sum + num(row, ["points_delta", "points"], 0), 0);
  }, [transactions]);

  const avgScore = filtered.length ? Math.round(filtered.reduce((sum, row) => sum + num(row, ["score", "total_score", "final_score", "rating"], 0), 0) / filtered.length) : 0;
  const topDoctor = perDoctor[0]?.name || "-";

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl border border-teal-400/20 bg-[#10213a] p-5">
        <h1 className="text-2xl font-black text-white">تحليل أداء الواتساب</h1>
        <p className="mt-1 text-sm text-slate-400">تقرير دوري لجودة المحادثات، الترشيحات، الإغلاق، وربط النتائج بالمبيعات والنقاط.</p>
      </div>

      <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs text-slate-300 space-y-1"><span>من</span><input className="input-dark" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="text-xs text-slate-300 space-y-1"><span>إلى</span><input className="input-dark" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          <label className="text-xs text-slate-300 space-y-1"><span>الفرع</span><select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}><option>الكل</option>{branches.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="text-xs text-slate-300 space-y-1"><span>الدكتور/الموظف</span><select className="input-dark" value={doctor} onChange={(event) => setDoctor(event.target.value)}><option>الكل</option>{doctors.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
      </div>

      {error && <div className="stat-card text-red-200">تعذر تحميل بيانات تقييم المحادثات. تأكد من تشغيل جدول conversation_sales_reviews.</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric icon={MessageCircle} label="محادثات مراجعة" value={filtered.length} />
        <Metric icon={Star} label="متوسط الجودة" value={`${avgScore}%`} />
        <Metric icon={Users} label="أفضل أداء" value={topDoctor} />
        <Metric icon={TrendingUp} label="مبيعات مرتبطة" value={formatCurrency(linkedInvoiceSales)} />
        <Metric icon={BarChart3} label="أثر النقاط" value={relatedPoints.toLocaleString("ar-EG")} />
      </div>

      <div className="rounded-2xl border border-[#2d4063] bg-[#1B2B4B] overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-300">جاري تحميل تحليل الواتساب...</div>
        ) : perDoctor.length === 0 ? (
          <div className="p-10 text-center text-slate-400">لا توجد محادثات مراجعة في الفترة المحددة.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الدكتور/الموظف</th>
                  <th>عدد المراجعات</th>
                  <th>متوسط الدرجة</th>
                  <th>ممتازة</th>
                  <th>ضعيفة</th>
                  <th>مبيعات مولدة</th>
                  <th>نقاط</th>
                  <th>توصية تدريب</th>
                </tr>
              </thead>
              <tbody>
                {perDoctor.map((row) => (
                  <tr key={row.name}>
                    <td className="font-bold text-white">{row.name}</td>
                    <td>{row.count}</td>
                    <td className="text-teal-300 font-bold">{row.avg}%</td>
                    <td>{row.excellent}</td>
                    <td className={row.weak ? "text-red-300 font-bold" : ""}>{row.weak}</td>
                    <td>{formatCurrency(row.sales)}</td>
                    <td>{row.points}</td>
                    <td>{row.weak > 0 || row.avg < 70 ? "تدريب على جودة الرد والإغلاق" : "لا توجد توصية عاجلة"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="stat-card">
      <Icon size={18} className="text-teal-300" />
      <div className="mt-3 text-xl font-black text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}
