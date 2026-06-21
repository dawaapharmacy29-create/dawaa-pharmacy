import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Headphones, UserX } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Counts = {
  pendingFollowups: number;
  uncodedCustomers: number;
  openShiftNotes: number;
};

export default function Dashboard() {
  const [counts, setCounts] = useState<Counts>({ pendingFollowups: 0, uncodedCustomers: 0, openShiftNotes: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  const shiftName = useMemo(() => {
    const hour = now.getHours();
    if (hour >= 9 && hour < 18) return 'الوردية الصباحية';
    if (hour >= 18 || hour < 2) return 'الوردية المسائية';
    return 'الوردية الليلية';
  }, [now]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const followups = await supabase.from('followups').select('id', { count: 'exact', head: true }).neq('followup_status', 'completed');
        const customers = await supabase.from('customers').select('id', { count: 'exact', head: true }).is('customer_code', null);
        const notes = await supabase.from('shift_notes').select('id', { count: 'exact', head: true }).neq('status', 'done');
        if (followups.error) throw followups.error;
        if (customers.error) throw customers.error;
        if (notes.error) throw notes.error;
        if (mounted) {
          setCounts({ pendingFollowups: followups.count || 0, uncodedCustomers: customers.count || 0, openShiftNotes: notes.count || 0 });
        }
      } catch (err) {
        console.warn('Failed to load dashboard pulse', err);
        if (mounted) setError('تعذر تحميل نبضة الوردية حاليًا.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  const cards = [
    { title: 'متابعات معلقة', value: counts.pendingFollowups, icon: Headphones, hint: 'متابعات خدمة العملاء غير المكتملة' },
    { title: 'عملاء بدون كود', value: counts.uncodedCustomers, icon: UserX, hint: 'عملاء يحتاجون استكمال التكويد' },
    { title: 'ملاحظات شيفت مفتوحة', value: counts.openShiftNotes, icon: ClipboardCheck, hint: 'ملاحظات لم يتم إغلاقها بعد' },
  ];

  return (
    <main dir="rtl" className="min-h-[calc(100vh-6rem)] bg-[var(--dawaa-theme-bg)] p-4 md:p-6">
      <section className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-bold text-teal-500">نبضة الوردية</p>
              <h1 className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">لوحة تشغيل سريعة</h1>
              <p className="mt-2 text-sm text-[var(--dawaa-theme-muted)]">
                {shiftName} · {now.toLocaleDateString('ar-EG')} · {now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <Link to="/executive-2027" className="inline-flex items-center justify-center rounded-2xl bg-teal-600 px-5 py-3 text-sm font-black text-white transition hover:bg-teal-500">
              اذهب للوحة القيادة الكاملة
            </Link>
          </div>
        </div>

        {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-bold text-red-300">{error}</div>}

        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-5 shadow-sm">
                <div className="mb-4 w-fit rounded-2xl bg-teal-500/10 p-3 text-teal-500"><Icon className="h-6 w-6" /></div>
                <p className="text-sm font-bold text-[var(--dawaa-theme-muted)]">{card.title}</p>
                <div className="mt-2 text-4xl font-black text-[var(--dawaa-theme-heading)]">{loading ? '...' : card.value.toLocaleString('ar-EG')}</div>
                <p className="mt-3 text-xs font-semibold text-[var(--dawaa-theme-muted)]">{card.hint}</p>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
