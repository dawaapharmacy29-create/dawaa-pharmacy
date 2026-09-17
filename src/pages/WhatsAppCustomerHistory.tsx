import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Search, User, TrendingUp, Clock3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type CustomerListRow = { customer_name: string; total_conversations: number; last_conversation_at: string; conversion_rate_pct: number };
type CustomerSession = {
  id: string; started_at: string; ended_at: string; staff_name: string | null; branch: string | null;
  message_count: number; confidence: number; commercial_eligible: boolean; followup_required: boolean;
  suggested_followup_reason: string | null; outcome: string | null; primary_type: string | null;
};
type CustomerHistory = {
  customer_name: string; total_conversations: number; sale_intent_conversations: number;
  conversion_rate_pct: number; followup_conversations: number; sessions: CustomerSession[];
};

export default function WhatsAppCustomerHistory() {
  const [customers, setCustomers] = useState<CustomerListRow[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadList = useCallback(async (term: string) => {
    setLoadingList(true);
    const { data, error } = await supabase.rpc('whatsapp_customers_list_v1', { p_search: term || null });
    if (error) toast.error(error.message);
    else setCustomers((data || []) as CustomerListRow[]);
    setLoadingList(false);
  }, []);

  useEffect(() => { void loadList(''); }, [loadList]);

  async function openCustomer(name: string) {
    setSelected(name);
    setLoadingHistory(true);
    const { data, error } = await supabase.rpc('whatsapp_customer_history_v1', { p_customer_name: name });
    if (error) toast.error(error.message);
    else setHistory(data as CustomerHistory);
    setLoadingHistory(false);
  }

  return (
    <div className="dawaa-text grid gap-4 p-4 lg:grid-cols-[320px_1fr]" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h2 className="mb-2 font-black text-[var(--dawaa-theme-heading)]">العملاء</h2>
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-[var(--dawaa-theme-border)] px-2">
          <Search size={14} className="text-[var(--dawaa-theme-muted)]" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); void loadList(e.target.value); }} placeholder="ابحث باسم العميل" className="w-full bg-transparent p-2 text-xs outline-none" />
        </div>
        {loadingList && <div className="h-40 animate-pulse rounded-xl bg-[var(--dawaa-theme-surface-2)]" />}
        <div className="max-h-[70vh] space-y-1 overflow-y-auto">
          {customers.map((c) => (
            <button key={c.customer_name} onClick={() => void openCustomer(c.customer_name)} className={`w-full rounded-xl border p-2.5 text-right text-xs transition ${selected === c.customer_name ? 'border-[var(--dawaa-theme-primary)] bg-[var(--dawaa-theme-primary)]/10' : 'border-[var(--dawaa-theme-border)] hover:bg-[var(--dawaa-theme-surface-2)]'}`}>
              <div className="font-black text-[var(--dawaa-theme-heading)]">{c.customer_name}</div>
              <div className="mt-0.5 flex items-center justify-between font-bold text-[var(--dawaa-theme-muted)]">
                <span>{c.total_conversations} محادثة</span>
                <span className={c.conversion_rate_pct >= 40 ? 'text-emerald-400' : 'text-amber-400'}>{c.conversion_rate_pct}%</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        {!selected && <div className="flex h-full items-center justify-center text-sm font-bold text-[var(--dawaa-theme-muted)]">اختر عميل من القائمة لعرض سجل محادثاته الكامل</div>}
        {selected && loadingHistory && <div className="h-64 animate-pulse rounded-xl bg-[var(--dawaa-theme-surface-2)]" />}
        {selected && !loadingHistory && history && (
          <div>
            <div className="mb-4 flex items-center gap-2">
              <User size={20} className="text-[var(--dawaa-theme-primary-strong)]" />
              <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">{history.customer_name}</h2>
            </div>
            <div className="mb-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-center">
                <div className="text-xl font-black text-[var(--dawaa-theme-heading)]">{history.total_conversations}</div>
                <div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">إجمالي المحادثات</div>
              </div>
              <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-xl font-black text-emerald-400"><TrendingUp size={16} /> {history.conversion_rate_pct}%</div>
                <div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">معدل التحويل الشخصي</div>
              </div>
              <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-center">
                <div className="text-xl font-black text-amber-400">{history.followup_conversations}</div>
                <div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">محادثات تحتاج متابعة</div>
              </div>
            </div>

            <div className="max-h-[55vh] space-y-2 overflow-y-auto">
              {history.sessions.map((s) => (
                <div key={s.id} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 font-bold text-[var(--dawaa-theme-muted)]"><Clock3 size={12} /> {new Date(s.started_at).toLocaleString('ar-EG')}</span>
                    <span className="font-black text-[var(--dawaa-theme-heading)]">{s.staff_name || '-'}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--dawaa-theme-surface-2)] px-2 py-0.5 font-bold text-[var(--dawaa-theme-muted)]">{s.message_count} رسالة</span>
                    {s.commercial_eligible && <span className="rounded-full border border-emerald-800 bg-emerald-950 px-2 py-0.5 font-black text-emerald-300">نية شراء</span>}
                    {s.followup_required && <span className="rounded-full border border-amber-800 bg-amber-950 px-2 py-0.5 font-black text-amber-300">تحتاج متابعة</span>}
                    {s.outcome && <span className="text-[var(--dawaa-theme-muted)]">النتيجة: {s.outcome}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
