import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, MessageCircle, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { safeRows, safeText } from '@/lib/safeSupabase';
import { CommandHeader, MetricCard, SectionState } from '@/components/command/CommandUI';

type Cycle = Record<string, unknown>;
const initial = {
  customer_name: '',
  phone: '',
  medication_name: '',
  cycle_days: 30,
  last_purchase_date: new Date().toISOString().slice(0, 10),
  next_refill_date: '',
  reminder_days_before: 5,
  status: 'active',
  notes: '',
  branch: '',
};
function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}
function whatsapp(phone: string, name: string) {
  const clean = phone.replace(/\D/g, '').replace(/^0/, '20');
  return `https://wa.me/${clean}?text=${encodeURIComponent(`أهلاً أستاذ/أستاذة ${name}، بنطمن حضرتك هل تحتاج تجهيز علاج الشهر؟`)}`;
}

export default function RefillReminders() {
  const [rows, setRows] = useState<Cycle[]>([]);
  const [form, setForm] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const result = await safeRows<Cycle>('customer_medication_cycles', (q) =>
      q.order('next_refill_date', { ascending: true }).limit(500)
    );
    setRows(result.rows);
    setUnavailable(!result.available);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const due = useMemo(
    () =>
      rows.filter((r) => {
        const next = safeText(r.next_refill_date);
        const before = Number(r.reminder_days_before || 5);
        if (!next) return false;
        const alert = new Date(`${next}T12:00:00`);
        alert.setDate(alert.getDate() - before);
        return alert <= new Date() && safeText(r.status, 'active') === 'active';
      }),
    [rows]
  );
  const save = async () => {
    if (!form.customer_name.trim() || !form.phone.trim() || !form.medication_name.trim()) {
      toast.error('أكمل اسم العميل والهاتف والدواء');
      return;
    }
    const next = form.next_refill_date || addDays(form.last_purchase_date, form.cycle_days);
    const { error } = await supabase
      .from('customer_medication_cycles')
      .insert({ ...form, next_refill_date: next });
    if (error) {
      toast.error(unavailable ? 'طبّق ملف إعداد إعادة الصرف أولًا' : error.message);
      return;
    }
    toast.success('تمت إضافة دورة العلاج');
    setForm(initial);
    void load();
  };
  return (
    <div className="space-y-5" dir="rtl">
      <CommandHeader
        badge="Customer Care"
        title="متابعة إعادة صرف الدواء"
        description="تنبيهات عملية لعملاء الأمراض المزمنة قبل موعد تجهيز علاج الشهر."
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          icon={CalendarClock}
          label="دورات نشطة"
          value={rows.filter((r) => safeText(r.status, 'active') === 'active').length}
        />
        <MetricCard
          icon={RefreshCw}
          label="تحتاج تواصل الآن"
          value={due.length}
          tone={due.length ? 'amber' : 'green'}
        />
        <MetricCard
          icon={MessageCircle}
          label="رسائل واتساب جاهزة"
          value={due.filter((r) => safeText(r.phone)).length}
        />
      </section>
      <section className="dawaa-panel">
        <h2 className="mb-4 text-lg font-black text-slate-950 dark:text-white">إضافة دورة علاج</h2>
        {unavailable && (
          <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm font-bold text-amber-600">
            الجدول غير موجود أو غير مفعّل. طبّق ملف SUPABASE_REFILL_REMINDERS_SETUP.sql عند
            الاستعداد.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            className="dawaa-input"
            placeholder="اسم العميل"
            value={form.customer_name}
            onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
          />
          <input
            className="dawaa-input"
            placeholder="رقم الهاتف"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            className="dawaa-input"
            placeholder="الدواء أو التصنيف"
            value={form.medication_name}
            onChange={(e) => setForm({ ...form, medication_name: e.target.value })}
          />
          <select
            className="dawaa-input"
            value={form.cycle_days}
            onChange={(e) => setForm({ ...form, cycle_days: Number(e.target.value) })}
          >
            {[30, 45, 60].map((d) => (
              <option key={d} value={d}>
                {d} يوم
              </option>
            ))}
          </select>
          <input
            className="dawaa-input"
            type="date"
            value={form.last_purchase_date}
            onChange={(e) => setForm({ ...form, last_purchase_date: e.target.value })}
          />
          <input
            className="dawaa-input"
            type="date"
            value={form.next_refill_date}
            onChange={(e) => setForm({ ...form, next_refill_date: e.target.value })}
          />
          <input
            className="dawaa-input"
            placeholder="الفرع"
            value={form.branch}
            onChange={(e) => setForm({ ...form, branch: e.target.value })}
          />
          <input
            className="dawaa-input"
            placeholder="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <button
          onClick={() => void save()}
          className="dawaa-button-primary mt-4 inline-flex items-center gap-2"
        >
          <Plus size={16} /> حفظ الدورة
        </button>
      </section>
      <SectionState loading={loading} empty={!rows.length}>
        <section className="dawaa-panel overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-right text-slate-500">
                <th className="p-3">العميل</th>
                <th className="p-3">العلاج</th>
                <th className="p-3">الموعد القادم</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">تواصل</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={safeText(r.id)}
                  className="border-b border-slate-100 dark:border-slate-800"
                >
                  <td className="p-3 font-bold">
                    {safeText(r.customer_name)}
                    <div className="text-xs text-slate-500">{safeText(r.phone)}</div>
                  </td>
                  <td className="p-3">{safeText(r.medication_name)}</td>
                  <td className="p-3">{safeText(r.next_refill_date)}</td>
                  <td className="p-3">{safeText(r.status, 'active')}</td>
                  <td className="p-3">
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={whatsapp(safeText(r.phone), safeText(r.customer_name))}
                      className="inline-flex rounded-xl bg-emerald-500 p-2 text-white"
                    >
                      <MessageCircle size={16} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </SectionState>
    </div>
  );
}
