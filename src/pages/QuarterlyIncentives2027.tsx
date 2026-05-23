import { useMemo } from "react";
import { Award, Crown, FileText, TrendingUp, Users } from "lucide-react";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { formatMoney, formatNumber, getInvoiceAmount, getInvoiceCustomer, getInvoiceDoctor, normalizeArabicName, quarterlyIncentiveFromScore, quarterlyPillars2027 } from "@/lib/dawaa2027";
import { matchStaffInvoice, matchStaffName } from "@/lib/dawaa2027Data";

function getQuarterRange(date = new Date()) {
  const month = date.getMonth();
  const qStartMonth = Math.floor(month / 3) * 3;
  const start = new Date(date.getFullYear(), qStartMonth, 1);
  const end = new Date(date.getFullYear(), qStartMonth + 3, 0, 23, 59, 59);
  return { start, end, label: `الربع ${Math.floor(month / 3) + 1} ${date.getFullYear()}` };
}

export default function QuarterlyIncentives2027() {
  const { data: invoices } = useSupabaseQuery<Record<string, unknown>>({ table: "sales_invoices", limit: 10000, realtimeEnabled: false });
  const { data: staff } = useSupabaseQuery<Record<string, unknown>>({ table: "staff", limit: 500, realtimeEnabled: false });
  const { data: targets } = useSupabaseQuery<Record<string, unknown>>({ table: "doctor_incentive_targets", limit: 5000, realtimeEnabled: false });
  const { data: listSales } = useSupabaseQuery<Record<string, unknown>>({ table: "doctor_incentive_sales", limit: 5000, realtimeEnabled: false });
  const { data: stagnantDispenses } = useSupabaseQuery<Record<string, unknown>>({ table: "stagnant_medicine_dispenses", limit: 5000, realtimeEnabled: false });
  const { data: transactions } = useSupabaseQuery<Record<string, unknown>>({ table: "employee_transactions", limit: 5000, realtimeEnabled: false });
  const quarter = getQuarterRange();

  const rows = useMemo(() => {
    const quarterInvoices = invoices.filter((row) => {
      const raw = String(row.invoice_date || row.date || row.created_at || "");
      if (!raw) return false;
      const d = new Date(raw);
      return d >= quarter.start && d <= quarter.end;
    });
    const staffDoctors = staff.filter((s) => /صيدلي|صيدلاني|دكتور|doctor|pharmacist/i.test(String(s.role || "")) || String(s.name || "").includes("د"));
    const doctors = staffDoctors.length ? staffDoctors : staff;
    const rows = doctors.map((doctor) => {
      const doctorInvoices = quarterInvoices.filter((invoice) => matchStaffInvoice(invoice, doctor));
      const sales = doctorInvoices.reduce((sum, invoice) => sum + getInvoiceAmount(invoice), 0);
      const invoiceCount = doctorInvoices.length;
      const avg = invoiceCount ? sales / invoiceCount : 0;
      const customerValues = new Map<string, number>();
      doctorInvoices.forEach((invoice) => {
        const customer = getInvoiceCustomer(invoice) || "عميل غير محدد";
        customerValues.set(customer, (customerValues.get(customer) || 0) + getInvoiceAmount(invoice));
      });
      const targetRows = targets.filter((target) => String(target.staff_id || "") === String(doctor.id || "") || matchStaffName(target, doctor, ["staff_name", "doctor_name", "responsible_doctor"]));
      const salesRows = listSales.filter((sale) => String(sale.staff_id || sale.doctor_id || "") === String(doctor.id || "") || matchStaffName(sale, doctor, ["staff_name", "doctor_name", "responsible_doctor"]));
      const targetQty = targetRows.reduce((sum, row) => sum + Number(row.target_quantity || row.quantity_target || 0), 0);
      const achievedQty = salesRows.reduce((sum, row) => sum + Number(row.quantity || row.qty || 0), 0);
      const stagnantRows = stagnantDispenses.filter((row) => String(row.staff_id || row.doctor_id || "") === String(doctor.id || "") || matchStaffName(row, doctor, ["staff_name", "doctor_name", "responsible_doctor_name"]));
      const dataQualityInvoices = doctorInvoices.filter((invoice) => Boolean(getInvoiceCustomer(invoice)) && Boolean(getInvoiceDoctor(invoice))).length;
      const penalties = transactions.filter((t) => String(t.staff_id || "") === String(doctor.id || "") && String(t.type || "").toLowerCase().includes("penalty"));
      const topCustomer = [...customerValues.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        name: String(doctor.name || "غير محدد"),
        sales,
        invoices: invoiceCount,
        avg,
        customers: customerValues,
        targetQty,
        achievedQty,
        stagnantCount: stagnantRows.length,
        dataQuality: invoiceCount ? dataQualityInvoices / invoiceCount : 0,
        penalties: penalties.length,
        topCustomer,
      };
    }).filter((row) => row.invoices || row.targetQty || row.stagnantCount);
    const maxSales = Math.max(1, ...rows.map((r) => r.sales));
    const maxAvg = Math.max(1, ...rows.map((r) => r.avg));
    const maxCustomers = Math.max(1, ...rows.map((r) => r.customers.size));
    return rows.map((r) => {
      const listRatio = r.targetQty ? Math.min(1, r.achievedQty / r.targetQty) : 0;
      const scoreSales = Math.min(25, Math.round((r.sales / maxSales) * 25));
      const scoreAvg = Math.min(20, Math.round((r.avg / maxAvg) * 20));
      const scoreCustomers = Math.min(20, Math.round((r.customers.size / maxCustomers) * 20));
      const scoreList = Math.round(listRatio * 15);
      const scoreStock = Math.min(10, r.stagnantCount * 2);
      const scoreQuality = Math.max(0, Math.round(r.dataQuality * 10) - Math.min(5, r.penalties));
      const score = scoreSales + scoreAvg + scoreCustomers + scoreList + scoreStock + scoreQuality;
      return { ...r, scoreSales, scoreAvg, scoreCustomers, scoreList, scoreStock, scoreQuality, score, incentive: quarterlyIncentiveFromScore(score) };
    }).sort((a, b) => b.score - a.score);
  }, [invoices, staff, targets, listSales, stagnantDispenses, transactions, quarter.start, quarter.end]);

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="page-title">الحافز الربع سنوي 2027</h1>
          <p className="mt-2 text-sm leading-7 text-slate-400">حافز نمو ومبيعات بقيمة 2000 جنيه للدكاترة، منفصل عن حافز 500 نقطة الشهري. يقيس المبيعات، متوسط الفاتورة، العملاء، اللستة، الرواكد، وجودة التسجيل.</p>
        </div>
        <div className="rounded-2xl border border-teal-500/20 bg-teal-500/10 px-4 py-3 text-teal-200">{quarter.label}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Crown} label="قيمة الحافز الكامل" value="2000 جنيه" hint="100 نقطة ربع سنوية" />
        <Kpi icon={TrendingUp} label="دكاترة لهم فواتير" value={formatNumber(rows.length)} hint="حسب الفواتير المرفوعة" />
        <Kpi icon={Award} label="أعلى حافز متوقع" value={formatMoney(Math.max(0, ...rows.map((r) => r.incentive)))} hint="قبل اعتماد المدير" />
        <Kpi icon={Users} label="أعلى عملاء بالقيمة" value={rows[0]?.topCustomer?.[0] || "-"} hint={rows[0] ? formatMoney(rows[0].topCustomer?.[1] || 0) : ""} />
      </div>

      <div className="stat-card">
        <h2 className="section-title mb-4">محاور التقييم</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {quarterlyPillars2027.map((p) => <div key={p.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between"><div className="font-bold text-white">{p.label}</div><span className="badge-purple">{p.points}</span></div>
            <p className="mt-2 text-xs leading-6 text-slate-400">{p.description}</p>
          </div>)}
        </div>
      </div>

      <div className="stat-card overflow-x-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">ترتيب الدكاترة في الربع الحالي</h2>
          <button onClick={() => window.print()} className="btn-secondary inline-flex items-center gap-2"><FileText className="h-4 w-4" /> طباعة/تصدير</button>
        </div>
        <table className="data-table min-w-[980px]">
          <thead><tr><th>الدكتور</th><th>المبيعات</th><th>الفواتير</th><th>متوسط الفاتورة</th><th>أفضل عميل بالقيمة</th><th>اللستة المحققة</th><th>رواكد</th><th>المبيعات</th><th>المتوسط</th><th>العملاء</th><th>اللستة</th><th>الرواكد</th><th>الجودة</th><th>الدرجة</th><th>الحافز</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.name}>
              <td className="font-bold text-white">{r.name}</td>
              <td>{formatMoney(r.sales)}</td><td>{r.invoices}</td><td>{formatMoney(r.avg)}</td><td>{r.topCustomer?.[0] || "-"}</td><td>{r.achievedQty}/{r.targetQty || "-"}</td><td>{r.stagnantCount}</td>
              <td>{r.scoreSales}/25</td><td>{r.scoreAvg}/20</td><td>{r.scoreCustomers}/20</td><td>{r.scoreList}/15</td><td>{r.scoreStock}/10</td><td>{r.scoreQuality}/10</td>
              <td className="font-black text-teal-300">{r.score}/100</td><td className="font-black text-white">{formatMoney(r.incentive)}</td>
            </tr>)}
          </tbody>
        </table>
        {!rows.length && <div className="p-8 text-center text-slate-400">لا توجد فواتير مرتبطة بالدكاترة في الربع الحالي.</div>}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint }: any) {
  return <div className="stat-card"><div className="flex items-center justify-between"><div><div className="text-xs text-slate-400">{label}</div><div className="mt-2 text-2xl font-black text-white">{value}</div><div className="mt-1 text-xs text-slate-500">{hint}</div></div><div className="rounded-2xl bg-purple-500/15 p-3 text-purple-300"><Icon className="h-6 w-6" /></div></div></div>;
}
