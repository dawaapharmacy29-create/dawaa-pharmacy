import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, DollarSign, Package, Trophy, UserRound } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export interface IncentiveDoctorSaleRow {
  id: string;
  medicine_id?: string | null;
  product_name?: string | null;
  doctor_name: string;
  branch?: string | null;
  quantity?: number | null;
  incentive_per_unit?: number | null;
  incentive_total?: number | null;
  sale_date?: string | null;
}

interface Props {
  rows: IncentiveDoctorSaleRow[];
  cycleLabel: string;
}

interface ProductLine {
  key: string;
  name: string;
  quantity: number;
  money: number;
  perUnit: number;
}

interface DoctorSummary {
  doctor: string;
  quantity: number;
  money: number;
  products: ProductLine[];
}

export default function IncentiveDoctorSummary({ rows, cycleLabel }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const doctors = useMemo<DoctorSummary[]>(() => {
    const doctorMap = new Map<string, Map<string, ProductLine>>();

    for (const row of rows) {
      const doctor = (row.doctor_name || 'غير محدد').trim() || 'غير محدد';
      const productKey = row.medicine_id || row.product_name || 'unknown-product';
      const productName = (row.product_name || 'صنف غير محدد').trim() || 'صنف غير محدد';
      const quantity = Number(row.quantity || 0);
      const money = Number(row.incentive_total || 0);
      const perUnit = Number(row.incentive_per_unit || (quantity > 0 ? money / quantity : 0));

      if (!doctorMap.has(doctor)) doctorMap.set(doctor, new Map());
      const productMap = doctorMap.get(doctor)!;
      const current = productMap.get(productKey) || {
        key: productKey,
        name: productName,
        quantity: 0,
        money: 0,
        perUnit,
      };
      current.quantity += quantity;
      current.money += money;
      if (!current.perUnit && perUnit) current.perUnit = perUnit;
      productMap.set(productKey, current);
    }

    return Array.from(doctorMap.entries())
      .map(([doctor, productMap]) => {
        const products = Array.from(productMap.values()).sort((a, b) => b.money - a.money || b.quantity - a.quantity || a.name.localeCompare(b.name, 'ar'));
        return {
          doctor,
          quantity: products.reduce((sum, item) => sum + item.quantity, 0),
          money: products.reduce((sum, item) => sum + item.money, 0),
          products,
        };
      })
      .sort((a, b) => b.money - a.money || b.quantity - a.quantity || a.doctor.localeCompare(b.doctor, 'ar'));
  }, [rows]);

  const totalMoney = doctors.reduce((sum, row) => sum + row.money, 0);
  const totalUnits = doctors.reduce((sum, row) => sum + row.quantity, 0);
  const totalDoctors = doctors.length;
  const leader = doctors[0] || null;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="عدد الدكاترة" value={totalDoctors} sub={`دورة ${cycleLabel}`} icon={<UserRound size={18} />} />
        <SummaryCard label="إجمالي الوحدات" value={totalUnits} sub="من أصناف الليستة" icon={<Package size={18} />} />
        <SummaryCard label="إجمالي الحوافز" value={formatCurrency(totalMoney)} sub="إجمالي استحقاق الدورة" icon={<DollarSign size={18} />} />
        <SummaryCard label="الأعلى حافزًا" value={leader?.doctor || '—'} sub={leader ? formatCurrency(leader.money) : 'لا توجد حركة'} icon={<Trophy size={18} />} />
      </div>

      {!doctors.length ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.025] p-10 text-center">
          <UserRound className="mx-auto text-slate-600" size={34} />
          <div className="mt-3 font-bold text-slate-300">لا توجد حركات حوافز في الدورة الحالية.</div>
          <div className="mt-1 text-xs text-slate-500">أول حركة بيع مثبتة لصنف من الليستة هتظهر هنا تلقائيًا باسم الدكتور.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {doctors.map((row, index) => {
            const isOpen = expanded === row.doctor;
            const detailTotal = row.products.reduce((sum, item) => sum + item.money, 0);
            const totalsMatch = Math.abs(detailTotal - row.money) < 0.01;
            return (
              <section key={row.doctor} className="overflow-hidden rounded-3xl border border-white/10 bg-[#15243e]/75 shadow-lg shadow-black/10">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : row.doctor)}
                  className="flex w-full items-center justify-between gap-4 p-4 text-right md:p-5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${index === 0 ? 'bg-amber-400/10 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'}`}>
                      {index === 0 ? <Trophy size={19} /> : <UserRound size={19} />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-black text-white">{row.doctor}</h3>
                        {index === 0 && <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-bold text-amber-200">الأول</span>}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{row.quantity} وحدة · {row.products.length} صنف مختلف</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-left">
                      <div className="text-[11px] text-slate-500">استحقاق الليستة</div>
                      <div className="mt-1 text-lg font-black text-emerald-300">{formatCurrency(row.money)}</div>
                    </div>
                    {isOpen ? <ChevronUp className="text-slate-400" size={19} /> : <ChevronDown className="text-slate-400" size={19} />}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-white/10 p-4 md:p-5">
                    <div className={`mb-3 rounded-2xl border px-3 py-2 text-xs ${totalsMatch ? 'border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-200' : 'border-red-400/20 bg-red-400/[0.07] text-red-200'}`}>
                      {totalsMatch ? 'مراجعة الحساب: مجموع تفاصيل الأصناف مطابق لإجمالي استحقاق الدكتور.' : 'تنبيه: يوجد فرق بين مجموع التفاصيل والإجمالي ويحتاج مراجعة.'}
                    </div>
                    <div className="overflow-auto rounded-2xl border border-white/10">
                      <table className="w-full min-w-[680px] text-sm">
                        <thead className="bg-white/5 text-slate-400">
                          <tr>
                            <th className="p-3 text-right">الصنف</th>
                            <th className="p-3 text-right">الكمية</th>
                            <th className="p-3 text-right">حافز الوحدة</th>
                            <th className="p-3 text-right">الإجمالي</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.products.map((product) => (
                            <tr key={product.key} className="border-t border-white/5">
                              <td className="p-3 font-semibold text-white">{product.name}</td>
                              <td className="p-3 text-slate-300">{product.quantity}</td>
                              <td className="p-3 text-slate-300">{formatCurrency(product.perUnit)}</td>
                              <td className="p-3 font-black text-emerald-300">{formatCurrency(product.money)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t border-white/10 bg-white/[0.035]">
                          <tr>
                            <td className="p-3 font-bold text-white">الإجمالي</td>
                            <td className="p-3 font-bold text-white">{row.quantity}</td>
                            <td className="p-3 text-slate-500">—</td>
                            <td className="p-3 text-base font-black text-emerald-300">{formatCurrency(row.money)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, icon }: { label: string; value: string | number; sub: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">{icon}</div>
        <div className="min-w-0">
          <div className="text-xs text-slate-400">{label}</div>
          <div className="mt-1 truncate text-lg font-black text-white" title={String(value)}>{value}</div>
          <div className="mt-1 truncate text-[11px] text-slate-600" title={sub}>{sub}</div>
        </div>
      </div>
    </div>
  );
}
