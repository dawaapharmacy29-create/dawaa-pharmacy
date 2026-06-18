import { useEffect, useMemo, useState } from 'react';
import { Clock3, PackageCheck, ShoppingCart, Truck } from 'lucide-react';
import { safeRows, safeNumber, safeText } from '@/lib/safeSupabase';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';
type Row = Record<string, unknown>;
export default function SupplierPerformance() {
  const [purchases, setPurchases] = useState<Row[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void safeRows<Row>('purchases', (q) => q.limit(5000), 5000).then((r) => {
      setPurchases(r.rows);
      setAvailable(r.available);
      setLoading(false);
    });
  }, []);
  const suppliers = useMemo(() => {
    const map = new Map<string, Row[]>();
    purchases.forEach((r) => {
      const name = safeText(r.supplier_name ?? r.supplier, 'غير محدد');
      map.set(name, [...(map.get(name) || []), r]);
    });
    return [...map.entries()].map(([name, rows]) => {
      const accuracyValues = rows
        .map((r) => safeNumber(r.accuracy_percent ?? r.accuracy))
        .filter(Boolean);
      const delays = rows.map((r) => safeNumber(r.delay_days ?? r.delivery_delay_days));
      const missing = rows.reduce((s, r) => s + safeNumber(r.missing_items), 0);
      const extra = rows.reduce((s, r) => s + safeNumber(r.extra_items), 0);
      const unordered = rows.reduce((s, r) => s + safeNumber(r.unordered_items), 0);
      const accuracy = accuracyValues.length
        ? Math.round(accuracyValues.reduce((a, b) => a + b, 0) / accuracyValues.length)
        : null;
      const delay = delays.length
        ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)
        : 0;
      const rating =
        accuracy === null
          ? 'يحتاج ربط بيانات المشتريات'
          : accuracy >= 90 && delay <= 1
            ? 'ممتاز'
            : accuracy >= 75
              ? 'جيد'
              : 'يحتاج مراجعة';
      return {
        name,
        orders: rows.length,
        value: rows.reduce((s, r) => s + safeNumber(r.total_amount ?? r.value ?? r.net_total), 0),
        accuracy,
        delay,
        missing,
        extra,
        unordered,
        rating,
      };
    });
  }, [purchases]);
  return (
    <div className="space-y-5" dir="rtl">
      <CommandHeader
        badge="Supplier Scorecard"
        title="تقييم الموردين"
        description="متابعة دقة الموردين والتأخير ومشاكل استلام الأصناف من بيانات المشتريات الفعلية."
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard icon={Truck} label="الموردون" value={suppliers.length} />
        <MetricCard icon={ShoppingCart} label="الطلبيات" value={purchases.length} />
        <MetricCard
          icon={PackageCheck}
          label="إجمالي المشتريات"
          value={`${Math.round(suppliers.reduce((s, r) => s + r.value, 0)).toLocaleString('ar-EG')} ج`}
        />
        <MetricCard
          icon={Clock3}
          label="متوسط التأخير"
          value={
            suppliers.length
              ? `${Math.round(suppliers.reduce((s, r) => s + r.delay, 0) / suppliers.length)} يوم`
              : 'غير متاح'
          }
        />
      </section>
      {!available && (
        <div className="dawaa-panel text-center font-bold text-amber-600">
          تحتاج ربط بيانات المشتريات
        </div>
      )}
      <SectionState loading={loading} empty={!suppliers.length}>
        <section className="dawaa-panel overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-right text-slate-500">
                {[
                  'المورد',
                  'الطلبيات',
                  'القيمة',
                  'الدقة',
                  'التأخير',
                  'ناقص',
                  'زائد',
                  'بدون طلب',
                  'التقييم',
                ].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((r) => (
                <tr key={r.name} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="p-3 font-bold">{r.name}</td>
                  <td className="p-3">{r.orders}</td>
                  <td className="p-3">{Math.round(r.value).toLocaleString('ar-EG')} ج</td>
                  <td className="p-3">{r.accuracy === null ? 'غير متاح' : `${r.accuracy}%`}</td>
                  <td className="p-3">{r.delay} يوم</td>
                  <td className="p-3">{r.missing}</td>
                  <td className="p-3">{r.extra}</td>
                  <td className="p-3">{r.unordered}</td>
                  <td className="p-3">{r.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </SectionState>
    </div>
  );
}
