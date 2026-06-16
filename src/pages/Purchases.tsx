import { useCallback, useEffect, useState } from "react";
import { RefreshCw, PackageSearch, Truck, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";

type Supplier = { id: string; supplier_name: string; supplier_type?: string | null; active?: boolean | null };
type PurchaseInvoice = { id: string; invoice_no?: string | null; branch?: string | null; invoice_date?: string | null; net_total?: number | null; paid_amount?: number | null; remaining_amount?: number | null; status?: string | null };

function n(value: unknown) { const x = Number(value || 0); return Number.isFinite(x) ? x : 0; }

export default function Purchases() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [suppliersResult, invoicesResult] = await Promise.all([
        supabase.from("purchase_suppliers_v13").select("*").order("supplier_name"),
        supabase.from("purchase_invoices_v13").select("*").order("invoice_date", { ascending: false }).limit(50),
      ]);
      if (suppliersResult.error) throw suppliersResult.error;
      if (invoicesResult.error) throw invoicesResult.error;
      setSuppliers((suppliersResult.data || []) as Supplier[]);
      setInvoices((invoicesResult.data || []) as PurchaseInvoice[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل المشتريات");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totals = invoices.reduce((acc, row) => ({
    net: acc.net + n(row.net_total),
    paid: acc.paid + n(row.paid_amount),
    remaining: acc.remaining + n(row.remaining_amount),
  }), { net: 0, paid: 0, remaining: 0 });

  return <div className="space-y-5" dir="rtl">
    <div className="rounded-2xl border border-[#E5EAF0] bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">المشتريات والموردين V13</h1>
          <p className="mt-1 text-sm font-bold text-slate-500">أساس إدارة الموردين، الطلبيات، الفواتير، الدفعات والمتبقي.</p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-700">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""}/> تحديث
        </button>
      </div>
    </div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
    <div className="grid gap-3 md:grid-cols-4">
      <Card title="الموردون" value={suppliers.length.toLocaleString("ar-EG")} icon={Truck}/>
      <Card title="فواتير مشتريات" value={invoices.length.toLocaleString("ar-EG")} icon={FileText}/>
      <Card title="إجمالي الفواتير" value={formatCurrency(totals.net)} icon={PackageSearch}/>
      <Card title="المتبقي للموردين" value={formatCurrency(totals.remaining)} icon={PackageSearch}/>
    </div>
    <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-black text-slate-900">آخر فواتير المشتريات</h2>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="bg-slate-50 text-slate-600"><th className="p-3 text-right">رقم الفاتورة</th><th className="p-3 text-right">الفرع</th><th className="p-3 text-right">التاريخ</th><th className="p-3 text-right">الصافي</th><th className="p-3 text-right">المتبقي</th><th className="p-3 text-right">الحالة</th></tr></thead>
          <tbody>{invoices.map((row) => <tr key={row.id} className="border-t"><td className="p-3 font-bold">{row.invoice_no || "-"}</td><td className="p-3">{row.branch || "-"}</td><td className="p-3">{row.invoice_date || "-"}</td><td className="p-3">{formatCurrency(n(row.net_total))}</td><td className="p-3">{formatCurrency(n(row.remaining_amount))}</td><td className="p-3">{row.status || "-"}</td></tr>)}</tbody>
        </table>
      </div>
      {!invoices.length && <div className="rounded-xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">لا توجد فواتير مشتريات بعد. ابدأ بإضافة الموردين والفواتير في الجداول الجديدة.</div>}
    </div>
  </div>;
}

function Card({ title, value, icon: Icon }: { title: string; value: string; icon: any }) {
  return <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><div className="text-xs font-bold text-slate-500">{title}</div><div className="mt-2 text-2xl font-black text-slate-900">{value}</div></div><span className="rounded-2xl bg-teal-50 p-3 text-teal-700"><Icon size={20}/></span></div></div>;
}
