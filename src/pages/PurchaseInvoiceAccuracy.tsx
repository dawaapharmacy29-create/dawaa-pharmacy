import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Loader2, Search, ThumbsDown, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Panel, SectionTitle, EmptyState } from '@/components/dashboard/DashboardPrimitives';
import { searchActiveStaffByName, type StaffDirectoryOption } from '@/lib/staffDirectorySearch';

type StaffOption = StaffDirectoryOption;

type Outcome = 'correct' | 'mixup_unregistered' | 'negligence' | 'customer_problem';

const OUTCOME_CONFIG: Record<Outcome, { label: string; points: number; color: string; bg: string; borderColor: string; icon: typeof CheckCircle2 }> = {
  correct: { label: 'إدخال صحيح', points: 2, color: 'var(--dawaa-status-success-text)', bg: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)', icon: CheckCircle2 },
  mixup_unregistered: { label: 'لغبطة أو عدم تسجيل', points: -1, color: 'var(--dawaa-status-warning-text)', bg: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)', icon: AlertTriangle },
  negligence: { label: 'إهمال', points: -2, color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)', icon: ThumbsDown },
  customer_problem: { label: 'سبب مشكلة مع عميل', points: -4, color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)', icon: ThumbsDown },
};

const OUTCOME_ORDER: Outcome[] = ['correct', 'mixup_unregistered', 'negligence', 'customer_problem'];

type ReviewRow = {
  id: string;
  staff_id: string;
  staff_name: string;
  branch: string | null;
  invoice_reference: string | null;
  outcome: Outcome;
  points: number;
  notes: string | null;
  review_date: string;
  reviewed_by_name: string | null;
};

type QueueRow = {
  id: string;
  base44_id: string;
  system_invoice_number: string | null;
  branch: string | null;
  transaction_type: string | null;
  entered_by_raw: string | null;
  entered_by_staff_id: string | null;
  entered_by_staff_name: string | null;
  match_status: 'matched' | 'ambiguous' | 'unmatched' | 'empty';
  invoice_date: string | null;
  total_value: number | null;
};

const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  external_purchase: 'شراء خارجي',
  internal_transfer: 'تحويل بين فرعين',
};

export default function PurchaseInvoiceAccuracy() {
  const [search, setSearch] = useState('');
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffOption | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('correct');
  const [invoiceReference, setInvoiceReference] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<ReviewRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState(false);

  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveSearch, setResolveSearch] = useState('');
  const [resolveOptions, setResolveOptions] = useState<StaffOption[]>([]);
  const [pickedStaffByRow, setPickedStaffByRow] = useState<Record<string, StaffOption>>({});
  const [actingRowId, setActingRowId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setQueueError(false);
    const { data, error } = await supabase.rpc('list_base44_pending_invoice_reviews_v1', { p_limit: 100 });
    if (error) {
      setQueueError(true);
      setLoadingQueue(false);
      return;
    }
    setQueue((data || []) as QueueRow[]);
    setLoadingQueue(false);
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    const term = resolveSearch.trim();
    if (term.length < 2) {
      setResolveOptions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const options = await searchActiveStaffByName(term);
      if (!cancelled) setResolveOptions(options);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [resolveSearch]);

  const classifyQueueRow = useCallback(
    async (row: QueueRow, staffId: string, rowOutcome: Outcome) => {
      setActingRowId(row.id);
      try {
        const { error } = await supabase.rpc('log_base44_invoice_review_v1', {
          p_sync_id: row.id,
          p_staff_id: staffId,
          p_outcome: rowOutcome,
        });
        if (error) throw error;
        toast.success('اتسجل');
        setQueue((prev) => prev.filter((q) => q.id !== row.id));
        await loadHistory();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'حصل خطأ في الحفظ');
      } finally {
        setActingRowId(null);
      }
    },
    []
  );

  const resolveAndSaveAlias = useCallback(async (row: QueueRow, staff: StaffOption) => {
    if (!row.entered_by_raw) return;
    try {
      await supabase.rpc('resolve_base44_entered_by_alias_v1', {
        p_raw_name: row.entered_by_raw,
        p_staff_id: staff.id,
      });
      toast.success(`اتربط "${row.entered_by_raw}" بـ ${staff.name} — هيتطبق تلقائي المرة الجاية`);
    } catch {
      // اختيار الموظف لسه هيتم حتى لو فشل حفظ الربط الدائم
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(false);
    const { data, error } = await supabase.rpc('list_purchase_invoice_entry_reviews_v1', { p_limit: 40 });
    if (error) {
      setHistoryError(true);
      setLoadingHistory(false);
      return;
    }
    setHistory((data || []) as ReviewRow[]);
    setLoadingHistory(false);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setStaffOptions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const options = await searchActiveStaffByName(term);
      if (!cancelled) setStaffOptions(options);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search]);

  const handleSubmit = useCallback(async () => {
    if (!selectedStaff) {
      toast.error('اختار الموظف الأول');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('log_purchase_invoice_entry_review_v1', {
        p_staff_id: selectedStaff.id,
        p_outcome: outcome,
        p_branch: selectedStaff.branch,
        p_invoice_reference: invoiceReference.trim() || null,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      toast.success('اتسجل');
      setSelectedStaff(null);
      setSearch('');
      setInvoiceReference('');
      setNotes('');
      setOutcome('correct');
      await loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حصل خطأ في الحفظ');
    } finally {
      setSubmitting(false);
    }
  }, [selectedStaff, outcome, invoiceReference, notes, loadHistory]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24" dir="rtl">
      <div>
        <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>دقة إدخال فواتير المشتريات</h1>
        <p className="mt-1 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          تسجيل يدوي لحد ما تتظبط مزامنة Base44 — سجّل أي عملية إدخال شفتها، صح أو غلط.
        </p>
      </div>

      <Panel className="p-4">
        <SectionTitle title="فواتير Base44 محتاجة تصنيف" subtitle="متسحبة تلقائي من الدورة الحالية" icon={<Link2 size={18} />} />
        {loadingQueue ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : queueError ? (
          <EmptyState label="تعذّر تحميل قائمة Base44" error onRetry={() => void loadQueue()} />
        ) : queue.length === 0 ? (
          <EmptyState label="مفيش فواتير محتاجة تصنيف دلوقتي" />
        ) : (
          <div className="space-y-3">
            {queue.map((row) => {
              const resolvedStaff = row.entered_by_staff_id
                ? { id: row.entered_by_staff_id, name: row.entered_by_staff_name || '', branch: row.branch }
                : pickedStaffByRow[row.id] || null;
              return (
                <div key={row.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                      {row.system_invoice_number ? `فاتورة ${row.system_invoice_number}` : row.base44_id}
                    </p>
                    <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                      {row.branch} — {row.invoice_date} — {TRANSACTION_TYPE_LABEL[row.transaction_type || ''] || row.transaction_type}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                    {row.total_value != null ? `${row.total_value} جنيه` : ''}
                  </p>

                  {resolvedStaff ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-sm font-black" style={{ color: 'var(--dawaa-theme-text)' }}>
                        دخلها: {resolvedStaff.name}
                        {!row.entered_by_staff_id ? ' (اخترتها يدويًا)' : ''}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {OUTCOME_ORDER.map((key) => {
                          const cfg = OUTCOME_CONFIG[key];
                          return (
                            <button
                              key={key}
                              type="button"
                              disabled={actingRowId === row.id}
                              onClick={() => void classifyQueueRow(row, resolvedStaff.id, key)}
                              className="rounded-lg border py-2 text-xs font-black"
                              style={{ borderColor: cfg.borderColor, background: cfg.bg, color: cfg.color }}
                            >
                              {cfg.label} ({cfg.points > 0 ? '+' : ''}{cfg.points})
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : resolvingId === row.id ? (
                    <div className="mt-3 space-y-1">
                      <input
                        type="text"
                        className="input-dark w-full text-sm"
                        placeholder="اكتب اسم الموظف اللي دخلها فعلاً..."
                        value={resolveSearch}
                        onChange={(e) => setResolveSearch(e.target.value)}
                        autoFocus
                      />
                      {resolveOptions.length > 0 ? (
                        <div className="space-y-1 rounded-lg border p-1" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                          {resolveOptions.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setPickedStaffByRow((prev) => ({ ...prev, [row.id]: s }));
                                setResolvingId(null);
                                setResolveSearch('');
                                setResolveOptions([]);
                                if (row.match_status === 'unmatched') void resolveAndSaveAlias(row, s);
                              }}
                              className="flex w-full items-center justify-between rounded-md p-2 text-right text-sm hover:bg-[var(--dawaa-theme-soft)]"
                            >
                              <span className="font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{s.name}</span>
                              <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{s.branch}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setResolvingId(row.id)}
                      className="mt-3 flex items-center gap-2 text-sm font-black"
                      style={{ color: 'var(--dawaa-status-warning-text)' }}
                    >
                      <AlertTriangle size={14} />
                      {row.entered_by_raw ? `"${row.entered_by_raw}" مش معروف — اختار مين ده` : 'مسجّلش اسم — اختار مين دخلها'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel className="p-4 space-y-4">
        <SectionTitle title="تسجيل مراجعة يدوية" icon={<Users size={18} />} />

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>مين اللي دخل الفاتورة؟</p>
          {selectedStaff ? (
            <div className="flex items-center justify-between rounded-lg border p-2" style={{ borderColor: 'var(--dawaa-theme-primary)', background: 'var(--dawaa-theme-soft)' }}>
              <span className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{selectedStaff.name}</span>
              <button type="button" onClick={() => setSelectedStaff(null)} className="text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>تغيير</button>
            </div>
          ) : (
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--dawaa-theme-muted)' }} />
              <input
                type="text"
                className="input-dark w-full pr-8 text-sm"
                placeholder="اكتب اسم الموظف..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {staffOptions.length > 0 ? (
                <div className="mt-1 space-y-1 rounded-lg border p-1" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  {staffOptions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSelectedStaff(s);
                        setStaffOptions([]);
                      }}
                      className="flex w-full items-center justify-between rounded-md p-2 text-right text-sm hover:bg-[var(--dawaa-theme-soft)]"
                    >
                      <span className="font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{s.name}</span>
                      <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{s.branch}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>النتيجة</p>
          <div className="grid grid-cols-1 gap-2">
            {OUTCOME_ORDER.map((key) => {
              const cfg = OUTCOME_CONFIG[key];
              const Icon = cfg.icon;
              const active = outcome === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOutcome(key)}
                  className="flex items-center justify-between gap-2 rounded-xl border p-3 text-right transition"
                  style={{
                    borderColor: active ? cfg.borderColor : 'var(--dawaa-theme-border)',
                    background: active ? cfg.bg : 'transparent',
                  }}
                >
                  <span className="flex items-center gap-2 font-black" style={{ color: active ? cfg.color : 'var(--dawaa-theme-text)' }}>
                    <Icon size={16} /> {cfg.label}
                  </span>
                  <span className="text-xs font-black" style={{ color: cfg.color }}>
                    {cfg.points > 0 ? '+' : ''}{cfg.points} نقطة
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>رقم الفاتورة/الطلبية (اختياري)</p>
          <input type="text" className="input-dark w-full text-sm" value={invoiceReference} onChange={(e) => setInvoiceReference(e.target.value)} />
        </div>

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>ملاحظة</p>
          <input type="text" className="input-dark w-full text-sm" placeholder="تفاصيل سريعة..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white"
          style={{ background: 'var(--dawaa-theme-primary)' }}
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
          تسجيل
        </button>
      </Panel>

      <Panel className="p-4">
        <SectionTitle title="آخر المراجعات" />
        {loadingHistory ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : historyError ? (
          <EmptyState label="تعذّر تحميل السجل" error onRetry={() => void loadHistory()} />
        ) : history.length === 0 ? (
          <EmptyState label="لسه مفيش مراجعات مسجّلة" />
        ) : (
          <div className="space-y-2">
            {history.map((h) => {
              const cfg = OUTCOME_CONFIG[h.outcome];
              return (
                <div key={h.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{h.staff_name}</p>
                    <span className="rounded-full border px-2 py-0.5 text-[10px] font-black" style={{ borderColor: cfg.borderColor, background: cfg.bg, color: cfg.color }}>
                      {cfg.label} ({h.points > 0 ? '+' : ''}{h.points})
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{h.review_date} {h.invoice_reference ? `— فاتورة ${h.invoice_reference}` : ''}</p>
                  {h.notes ? <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{h.notes}</p> : null}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
