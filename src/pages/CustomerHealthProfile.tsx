import { useEffect, useState } from 'react';
import { HeartPulse, Save, Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { safeRows, safeText } from '@/lib/safeSupabase';
import { CommandHeader } from '@/components/command/CommandUI';

type Row = Record<string, unknown>;
const empty = {
  chronic_conditions: '',
  regular_medications: '',
  allergies: '',
  pharmacist_notes: '',
  important_warnings: '',
};
const list = (value: string) =>
  value
    .split(/[،,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);

export default function CustomerHealthProfile() {
  const [customers, setCustomers] = useState<Row[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(empty);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    void safeRows<Row>('customers', (q) => q.limit(1000), 1000).then((r) => setCustomers(r.rows));
  }, []);
  useEffect(() => {
    if (!customerId) {
      setForm(empty);
    } else {
      void safeRows<Row>(
        'customer_health_profiles',
        (q) => q.eq('customer_id', customerId).limit(1),
        1
      ).then((r) => {
        setAvailable(r.available);
        const p = r.rows[0];
        setForm(
          p
            ? {
                chronic_conditions: ((p.chronic_conditions as string[]) || []).join('، '),
                regular_medications: ((p.regular_medications as string[]) || []).join('، '),
                allergies: ((p.allergies as string[]) || []).join('، '),
                pharmacist_notes: safeText(p.pharmacist_notes),
                important_warnings: safeText(p.important_warnings),
              }
            : empty
        );
      });
    }
  }, [customerId]);
  const filtered = customers
    .filter((c) =>
      `${safeText(c.name ?? c.customer_name)} ${safeText(c.phone)} ${safeText(c.customer_code ?? c.code)}`.includes(
        query
      )
    )
    .slice(0, 30);
  const save = async () => {
    if (!customerId) {
      toast.error('اختر العميل أولًا');
      return;
    }
    const payload = {
      customer_id: customerId,
      chronic_conditions: list(form.chronic_conditions),
      regular_medications: list(form.regular_medications),
      allergies: list(form.allergies),
      pharmacist_notes: form.pharmacist_notes,
      important_warnings: form.important_warnings,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('customer_health_profiles')
      .upsert(payload, { onConflict: 'customer_id' });
    if (error) {
      toast.error(available ? error.message : 'طبّق ملف إعداد البطاقة الصحية أولًا');
      return;
    }
    toast.success('تم حفظ البطاقة الصحية');
  };
  return (
    <div className="space-y-5" dir="rtl">
      <CommandHeader
        badge="Health Card"
        title="البطاقة الصحية للعميل"
        description="معلومات دوائية مهمة تساعد الصيدلي على تقديم خدمة أكثر أمانًا واستمرارية."
      />
      <section className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="dawaa-panel">
          <div className="relative">
            <Search className="absolute right-3 top-3 h-4 w-4 text-slate-400" />
            <input
              className="dawaa-input w-full pr-10"
              placeholder="بحث بالاسم أو الهاتف أو الكود"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="mt-3 max-h-[520px] space-y-2 overflow-auto">
            {filtered.map((c) => (
              <button
                key={safeText(c.id)}
                onClick={() => setCustomerId(safeText(c.id))}
                className={`w-full rounded-xl border p-3 text-right ${customerId === safeText(c.id) ? 'border-teal-500 bg-teal-500/10' : 'border-slate-200 dark:border-slate-700'}`}
              >
                <div className="font-bold">{safeText(c.name ?? c.customer_name, 'عميل')}</div>
                <div className="text-xs text-slate-500">{safeText(c.phone)}</div>
              </button>
            ))}
          </div>
        </aside>
        <main className="dawaa-panel">
          {!available && (
            <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm font-bold text-amber-600">
              الجدول غير موجود أو غير مفعّل. طبّق SUPABASE_CUSTOMER_HEALTH_PROFILE_SETUP.sql.
            </p>
          )}
          {!customerId ? (
            <div className="py-16 text-center text-slate-500">
              <HeartPulse className="mx-auto mb-3" size={42} />
              <p className="font-bold">اختر عميلًا لعرض البطاقة الصحية</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="الأمراض المزمنة"
                value={form.chronic_conditions}
                onChange={(v) => setForm({ ...form, chronic_conditions: v })}
              />
              <Field
                label="الأدوية الدائمة"
                value={form.regular_medications}
                onChange={(v) => setForm({ ...form, regular_medications: v })}
              />
              <Field
                label="الحساسية"
                value={form.allergies}
                onChange={(v) => setForm({ ...form, allergies: v })}
              />
              <Field
                label="تحذيرات مهمة"
                value={form.important_warnings}
                onChange={(v) => setForm({ ...form, important_warnings: v })}
              />
              <div className="md:col-span-2">
                <Field
                  label="ملاحظات مهمة للصيدلي"
                  value={form.pharmacist_notes}
                  onChange={(v) => setForm({ ...form, pharmacist_notes: v })}
                />
              </div>
              <button
                onClick={() => void save()}
                className="dawaa-button-primary inline-flex items-center justify-center gap-2 md:col-span-2"
              >
                <Save size={16} /> حفظ البطاقة الصحية
              </button>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm font-black text-slate-700 dark:text-slate-200">
      {label}
      <textarea
        rows={4}
        className="dawaa-input mt-2 w-full resize-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="افصل القيم بفاصلة"
      />
    </label>
  );
}
