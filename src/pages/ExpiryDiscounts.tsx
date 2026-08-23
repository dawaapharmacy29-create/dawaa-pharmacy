import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, PackagePlus, Percent } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { safeNumber, safeText } from '@/lib/safeSupabase';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { BRANCHES } from '@/lib/constants';

type Row = Record<string, unknown>;
const initial = {
  medicine_name: '',
  branch: '',
  quantity: 1,
  expiry_date: '',
  status: 'new',
  notes: '',
};
function daysLeft(date: unknown) {
  const time = new Date(`${safeText(date)}T12:00:00`).getTime();
  return Number.isFinite(time) ? Math.ceil((time - Date.now()) / 86400000) : 0;
}
function discount(days: number) {
  if (days < 15) return 50;
  if (days <= 30) return 35;
  if (days <= 90) return 20;
  if (days <= 180) return 10;
  return 0;
}

export default function ExpiryDiscounts() {
  const { user, checkPermission } = useAuth();
  const allBranches = canViewAllBranches(user);
  const canManage = checkPermission('manage_medicines');
  const ownBranch = safeText(user?.branch);
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState(initial);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allBranches && ownBranch) {
      setForm((current) => ({ ...current, branch: ownBranch }));
    }
  }, [allBranches, ownBranch]);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('expiry_discount_items')
      .select('id,medicine_name,branch,quantity,expiry_date,suggested_discount,status,notes,created_at,updated_at')
      .order('expiry_date', { ascending: true })
      .limit(500);

    if (!allBranches && ownBranch) {
      query = query.eq('branch', ownBranch);
    }

    const { data, error } = await query;

    if (error) {
      setRows([]);
      toast.error(`تعذر تحميل خصومات الصلاحية: ${error.message}`);
    } else {
      setRows((data || []) as Row[]);
    }
    setLoading(false);
  }, [allBranches, ownBranch]);

  useEffect(() => {
    void load();
  }, [load]);

  const enriched = useMemo<Array<Row & { days: number; suggested: number }>>(
    () =>
      rows
        .map((r) => {
          const days = daysLeft(r.expiry_date);
          return { ...r, days, suggested: discount(days) } as Row & {
            days: number;
            suggested: number;
          };
        })
        .sort((a, b) => a.days - b.days),
    [rows]
  );

  const save = async () => {
    if (!canManage) {
      toast.error('ليس لديك صلاحية إدارة أصناف الصلاحية.');
      return;
    }
    if (!form.medicine_name.trim() || !form.expiry_date || !form.branch.trim()) {
      toast.error('أكمل اسم الصنف والفرع وتاريخ الانتهاء');
      return;
    }
    const days = daysLeft(form.expiry_date);
    const { error } = await supabase
      .from('expiry_discount_items')
      .insert({ ...form, suggested_discount: discount(days) });
    if (error) {
      toast.error(`تعذر إضافة الصنف: ${error.message}`);
      return;
    }
    toast.success('تمت إضافة الصنف');
    setForm({ ...initial, branch: allBranches ? '' : ownBranch });
    void load();
  };

  return (
    <div className="space-y-5" dir="rtl">
      <CommandHeader
        badge="Expiry Engine"
        title="عروض الأدوية قريبة الانتهاء"
        description="اقتراح خصم واضح حسب الأيام المتبقية، مع بقاء اعتماد الإجراء للإدارة."
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          icon={AlertTriangle}
          label="أقل من 30 يوم"
          value={enriched.filter((r) => r.days <= 30).length}
          tone="red"
        />
        <MetricCard
          icon={Percent}
          label="تحتاج خصمًا مقترحًا"
          value={enriched.filter((r) => r.suggested > 0).length}
          tone="amber"
        />
        <MetricCard
          icon={PackagePlus}
          label="إجمالي الكمية"
          value={enriched.reduce((s, r) => s + safeNumber(r.quantity), 0)}
        />
      </section>

      {canManage ? (
        <section className="dawaa-panel">
          <h2 className="mb-4 text-lg font-black text-slate-950 dark:text-white">إدخال يدوي</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <input
              className="dawaa-input"
              placeholder="اسم الصنف"
              value={form.medicine_name}
              onChange={(e) => setForm({ ...form, medicine_name: e.target.value })}
            />
            {allBranches ? (
              <select
                className="dawaa-input"
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })}
              >
                <option value="">اختر الفرع</option>
                {BRANCHES.map((branch) => (
                  <option key={branch} value={branch}>{branch}</option>
                ))}
              </select>
            ) : (
              <input className="dawaa-input" value={form.branch} readOnly aria-label="الفرع" />
            )}
            <input
              className="dawaa-input"
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            />
            <input
              className="dawaa-input"
              type="date"
              value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
            />
            <input
              className="dawaa-input"
              placeholder="ملاحظات"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <button onClick={() => void save()} className="dawaa-button-primary mt-4">
            إضافة الصنف
          </button>
        </section>
      ) : (
        <section className="dawaa-panel text-sm font-bold text-slate-600 dark:text-slate-300">
          الصفحة للعرض فقط على حسابك. إضافة أو تعديل أصناف الصلاحية متاح للمسؤولين عن إدارة الأدوية.
        </section>
      )}

      <SectionState loading={loading} empty={!enriched.length}>
        <section className="dawaa-panel overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-right text-slate-500">
                {['الصنف', 'الفرع', 'الكمية', 'الانتهاء', 'الأيام', 'الخصم المقترح', 'الحالة'].map(
                  (h) => (
                    <th key={h} className="p-3">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {enriched.map((r, i) => (
                <tr
                  key={safeText(r.id, String(i))}
                  className="border-b border-slate-100 dark:border-slate-800"
                >
                  <td className="p-3 font-bold">{safeText(r.medicine_name)}</td>
                  <td className="p-3">{safeText(r.branch)}</td>
                  <td className="p-3">{safeNumber(r.quantity)}</td>
                  <td className="p-3">{safeText(r.expiry_date)}</td>
                  <td className="p-3">{r.days}</td>
                  <td className="p-3 font-black">{r.suggested}%</td>
                  <td className="p-3">{safeText(r.status, 'new')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </SectionState>
    </div>
  );
}
