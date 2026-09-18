import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Inbox, Loader2, Sparkles, Users2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { invalidateCachedRpc } from '@/lib/attendance/cachedRpc';
import { cn } from '@/lib/utils';
import EmployeeProfileDrawer from '@/components/attendance/EmployeeProfileDrawer';

type ApprovalItem = {
  item_type: 'deduction' | 'overtime' | 'timeoff_branch' | 'timeoff_gm';
  item_id: string;
  staff_id: string;
  staff_name: string;
  branch: string;
  title: string;
  subtitle: string;
  amount: number | null;
  hours: number | null;
  requested_at: string;
  priority: number;
};

function formatHoursMinutes(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes < 60) return `${totalMinutes} دقيقة`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h} ساعة` : `${h} ساعة و${m} دقيقة`;
}

type OvertimeContext = {
  ready: boolean;
  reason?: string;
  staff_first_in?: string | null;
  staff_last_out?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  window_start?: string;
  window_end?: string;
  colleagues_working?: { staff_name: string; role: string | null; first_in: string | null; last_out: string | null }[];
  colleagues_count?: number;
  invoices_count?: number;
  invoices_total_amount?: number;
  invoices_sample?: { invoice_number: string; amount: number; time: string }[];
  recommendation?: string;
};

function formatClock(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });
}

const TYPE_META: Record<ApprovalItem['item_type'], { label: string; cls: string }> = {
  deduction: { label: 'خصم', cls: 'text-[var(--dawaa-status-danger-text)] bg-[var(--dawaa-status-danger-bg)] border-[var(--dawaa-status-danger-border)]' },
  overtime: { label: 'أوفرتايم', cls: 'text-[var(--dawaa-status-info-text)] bg-[var(--dawaa-status-info-bg)] border-[var(--dawaa-status-info-border)]' },
  timeoff_branch: { label: 'إذن (فرع)', cls: 'text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]' },
  timeoff_gm: { label: 'إذن (نهائي)', cls: 'text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]' },
};

export default function UnifiedApprovalsCenter() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<'all' | 'deduction' | 'overtime' | 'timeoff_branch' | 'timeoff_gm'>('all');
  const [profileStaffId, setProfileStaffId] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [contextData, setContextData] = useState<Record<string, OvertimeContext | 'loading' | 'error'>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  async function toggleContext(it: ApprovalItem) {
    const k = key(it);
    if (expandedRow === k) { setExpandedRow(null); return; }
    setExpandedRow(k);
    if (contextData[k]) return;
    setContextData((prev) => ({ ...prev, [k]: 'loading' }));
    try {
      const dateStr = it.requested_at.slice(0, 10);
      const { data, error } = await supabase.rpc('attendance_overtime_context_v1', { p_staff_id: it.staff_id, p_attendance_date: dateStr });
      if (error) throw error;
      setContextData((prev) => ({ ...prev, [k]: data as OvertimeContext }));
    } catch {
      setContextData((prev) => ({ ...prev, [k]: 'error' }));
    }
  }

  const key = (it: ApprovalItem) => `${it.item_type}:${it.item_id}`;
  const isBulkEligible = (it: ApprovalItem) => it.item_type === 'timeoff_branch' || it.item_type === 'timeoff_gm';

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('attendance_unified_approvals_v1');
    if (error) {
      toast.error(`تعذر تحميل مركز الاعتمادات: ${error.message}`);
      setItems([]);
    } else {
      setItems((data || []) as ApprovalItem[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = expanded === 'all' ? items : items.filter((i) => i.item_type === expanded);

  function toggleSelect(it: ApprovalItem) {
    if (!isBulkEligible(it)) {
      toast.info('الخصومات والأوفرتايم لازم يتراجعوا حالة بحالة');
      return;
    }
    const k = key(it);
    setSelected((prev) => { const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next; });
  }

  function toggleSelectAll() {
    const eligible = visible.filter(isBulkEligible);
    if (eligible.length && selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible.map(key)));
  }

  async function decideOne(it: ApprovalItem, decision: 'approve' | 'reject', note: string | null) {
    const { error } = await supabase.rpc('attendance_unified_approval_decide_v1', {
      p_item_type: it.item_type, p_item_id: it.item_id, p_decision: decision, p_note: note,
    });
    if (error) throw error;
  }

  async function decideBulk(decision: 'approve' | 'reject') {
    if (!selected.size) { toast.warning('اختر حالة واحدة على الأقل'); return; }
    setBusy(true);
    let ok = 0; let failed = 0;
    for (const it of visible) {
      if (!selected.has(key(it))) continue;
      if (!isBulkEligible(it)) continue;
      try { await decideOne(it, decision, null); ok++; } catch { failed++; }
    }
    invalidateCachedRpc('attendance_branch_role_group_rates_v1');
    toast.success(`${ok} حالة اتنفذت${failed ? ` — ${failed} فشلت` : ''}`);
    setSelected(new Set());
    setBusy(false);
    await load();
  }

  async function decideSingle(it: ApprovalItem, decision: 'approve' | 'reject') {
    const k = key(it);
    const note = (decisionNotes[k] || '').trim();

    if ((it.item_type === 'deduction' || it.item_type === 'overtime') && !note) {
      toast.warning('اكتب سبب القرار قبل اعتماد أو رفض الخصم/الأوفرتايم');
      return;
    }

    if (it.item_type === 'overtime' && decision === 'approve') {
      const ctx = contextData[k];
      if (!ctx || ctx === 'loading' || ctx === 'error' || !ctx.ready) {
        toast.warning('افتح تفاصيل الأوفرتايم وراجع الأدلة أولاً قبل الاعتماد');
        if (!ctx) await toggleContext(it);
        return;
      }
    }

    setBusy(true);
    try {
      await decideOne(it, decision, note || null);
      toast.success(decision === 'approve' ? 'تم الاعتماد' : 'تم الرفض');
      setDecisionNotes((prev) => ({ ...prev, [k]: '' }));
      invalidateCachedRpc('attendance_branch_role_group_rates_v1');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تنفيذ القرار');
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    all: items.length,
    deduction: items.filter((i) => i.item_type === 'deduction').length,
    overtime: items.filter((i) => i.item_type === 'overtime').length,
    timeoff_branch: items.filter((i) => i.item_type === 'timeoff_branch').length,
    timeoff_gm: items.filter((i) => i.item_type === 'timeoff_gm').length,
  };

  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-[var(--dawaa-theme-surface-2)]" />;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Inbox size={18} className="text-[var(--dawaa-theme-primary-strong)]" />
          <h3 className="font-black text-[var(--dawaa-theme-heading)]">مركز الاعتمادات — كل حاجة بانتظار قرارك في مكان واحد</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([['all','الكل'],['deduction','خصومات'],['overtime','أوفرتايم'],['timeoff_branch','أذونات (فرع)'],['timeoff_gm','أذونات (نهائي)']] as const).map(([k, label]) => (
            <button key={k} onClick={() => { setExpanded(k); setSelected(new Set()); }} className={cn('rounded-full border px-3 py-1.5 text-xs font-black', expanded === k ? 'border-[var(--dawaa-theme-primary)] bg-[var(--dawaa-theme-primary)] text-white' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)] hover:bg-[var(--dawaa-theme-surface-2)]')}>
              {label} ({counts[k]})
            </button>
          ))}
        </div>
      </div>

      {!visible.length ? (
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-8 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">لا توجد حالات بانتظار قرارك 🎉</div>
      ) : (
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-[var(--dawaa-theme-border)] pb-2">
            <label className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]">
              <input type="checkbox" checked={visible.filter(isBulkEligible).length > 0 && selected.size === visible.filter(isBulkEligible).length} onChange={toggleSelectAll} />
              تحديد الأذونات الآمنة للمعالجة الجماعية ({visible.filter(isBulkEligible).length})
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{selected.size} محدد</span>
                <button disabled={busy} onClick={() => void decideBulk('approve')} className="btn-primary flex items-center gap-1 px-3 py-1 text-xs"><CheckCircle2 size={13} /> اعتماد الكل</button>
                <button disabled={busy} onClick={() => void decideBulk('reject')} className="btn-secondary flex items-center gap-1 px-3 py-1 text-xs"><XCircle size={13} /> رفض الكل</button>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            {visible.map((it) => {
          const meta = TYPE_META[it.item_type];
          const k = key(it);
          const isExpanded = expandedRow === k;
          const ctx = contextData[k];
          return (
            <div key={k} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" disabled={!isBulkEligible(it)} checked={selected.has(k)} onChange={() => toggleSelect(it)} title={isBulkEligible(it) ? 'تحديد للمعالجة الجماعية' : 'هذه الحالة تحتاج قرارًا فرديًا'} />
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', meta.cls)}>{meta.label}</span>
                  <div>
                    <button onClick={() => setProfileStaffId(it.staff_id)} className="font-black text-[var(--dawaa-theme-heading)] hover:underline hover:text-[var(--dawaa-theme-primary-strong)]">{it.staff_name}</button>
                    <span className="mr-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">{it.branch} · {it.title} · {it.item_type === 'overtime' && it.hours != null ? `${formatHoursMinutes(it.hours)} · ` : ''}{it.subtitle}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {it.item_type === 'overtime' && (
                    <button onClick={() => void toggleContext(it)} title="تفاصيل ذكية لاتخاذ القرار" className={cn('flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs font-black', isExpanded ? 'border-[var(--dawaa-theme-primary)] bg-[var(--dawaa-theme-primary)] text-white' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-primary-strong)] hover:bg-[var(--dawaa-theme-surface-2)]')}>
                      {isExpanded ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  )}
                  <button disabled={busy} onClick={() => void decideSingle(it, 'approve')} className="btn-primary px-2 py-1 text-xs">اعتماد</button>
                  <button disabled={busy} onClick={() => void decideSingle(it, 'reject')} className="btn-secondary px-2 py-1 text-xs">رفض</button>
                </div>
              </div>

              {(it.item_type === 'deduction' || it.item_type === 'overtime') && (
                <div className="mt-2">
                  <input
                    value={decisionNotes[k] || ''}
                    onChange={(e) => setDecisionNotes((prev) => ({ ...prev, [k]: e.target.value }))}
                    placeholder={it.item_type === 'overtime' ? 'سبب قرار الأوفرتايم (إجباري)' : 'سبب قرار الخصم (إجباري)'}
                    className="input-dark w-full text-xs"
                  />
                </div>
              )}

              {isExpanded && (
                <div className="mt-2 rounded-lg border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
                  {ctx === 'loading' && <div className="flex items-center gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)]"><Loader2 size={14} className="animate-spin" /> جارٍ تحليل الفترة...</div>}
                  {ctx === 'error' && <div className="text-xs font-bold text-[var(--dawaa-status-danger-text)]">تعذر تحميل التفاصيل الذكية</div>}
                  {ctx && ctx !== 'loading' && ctx !== 'error' && !ctx.ready && <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{ctx.reason}</div>}
                  {ctx && ctx !== 'loading' && ctx !== 'error' && ctx.ready && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 rounded-lg border border-[var(--dawaa-theme-border)] p-2 text-xs font-black text-[var(--dawaa-theme-heading)]">
                        🕐 بصمته: دخل {formatClock(ctx.staff_first_in)} ← خرج {formatClock(ctx.staff_last_out)}
                        <span className="mr-auto font-bold text-[var(--dawaa-theme-muted)]">(الميعاد: {formatClock(ctx.scheduled_start_at)} ← {formatClock(ctx.scheduled_end_at)})</span>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-lg border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-2 text-xs font-black text-[var(--dawaa-status-info-text)]">
                        <Sparkles size={14} /> أدلة مساعدة فقط — القرار النهائي للإدارة بعد مراجعة الوقت والزملاء والمبيعات.
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2">
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-black text-[var(--dawaa-theme-heading)]"><Users2 size={13} /> زملاء كانوا شغالين معه ({ctx.colleagues_count ?? 0})</div>
                          {!ctx.colleagues_working?.length ? <p className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">محدش تاني كان موجود — كان لوحده</p> : (
                            <div className="space-y-1">{ctx.colleagues_working.map((c, i) => <div key={i} className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{c.staff_name} ({c.role || '-'}) — {formatClock(c.first_in)} ← {formatClock(c.last_out)}</div>)}</div>
                          )}
                        </div>
                        <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2">
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-black text-[var(--dawaa-theme-heading)]">🧾 فواتير بيع في نفس الفترة ({ctx.invoices_count ?? 0})</div>
                          <p className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">إجمالي القيمة: <span className="font-black text-[var(--dawaa-theme-heading)]">{ctx.invoices_total_amount ?? 0} ج.م</span></p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
          </div>
        </div>
      )}
      {profileStaffId && <EmployeeProfileDrawer staffId={profileStaffId} onClose={() => setProfileStaffId(null)} />}
    </div>
  );
}
