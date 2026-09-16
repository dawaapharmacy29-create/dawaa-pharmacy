import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Inbox, XCircle } from 'lucide-react';
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
  requested_at: string;
  priority: number;
};

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

  const key = (it: ApprovalItem) => `${it.item_type}:${it.item_id}`;

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

  function toggleSelect(k: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next; });
  }

  function toggleSelectAll() {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map(key)));
  }

  async function decideOne(it: ApprovalItem, decision: 'approve' | 'reject') {
    const { error } = await supabase.rpc('attendance_unified_approval_decide_v1', {
      p_item_type: it.item_type, p_item_id: it.item_id, p_decision: decision, p_note: null,
    });
    if (error) throw error;
  }

  async function decideBulk(decision: 'approve' | 'reject') {
    if (!selected.size) { toast.warning('اختر حالة واحدة على الأقل'); return; }
    setBusy(true);
    let ok = 0; let failed = 0;
    for (const it of visible) {
      if (!selected.has(key(it))) continue;
      try { await decideOne(it, decision); ok++; } catch { failed++; }
    }
    invalidateCachedRpc('attendance_branch_role_group_rates_v1');
    toast.success(`${ok} حالة اتنفذت${failed ? ` — ${failed} فشلت` : ''}`);
    setSelected(new Set());
    setBusy(false);
    await load();
  }

  async function decideSingle(it: ApprovalItem, decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await decideOne(it, decision);
      toast.success(decision === 'approve' ? 'تم الاعتماد' : 'تم الرفض');
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
              <input type="checkbox" checked={selected.size > 0 && selected.size === visible.length} onChange={toggleSelectAll} />
              تحديد الكل ({visible.length})
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
              return (
                <div key={k} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-theme-border)] p-2.5">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={selected.has(k)} onChange={() => toggleSelect(k)} />
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', meta.cls)}>{meta.label}</span>
                    <div>
                      <button onClick={() => setProfileStaffId(it.staff_id)} className="font-black text-[var(--dawaa-theme-heading)] hover:underline hover:text-[var(--dawaa-theme-primary-strong)]">{it.staff_name}</button>
                      <span className="mr-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">{it.branch} · {it.title} · {it.subtitle}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button disabled={busy} onClick={() => void decideSingle(it, 'approve')} className="btn-primary px-2 py-1 text-xs">اعتماد</button>
                    <button disabled={busy} onClick={() => void decideSingle(it, 'reject')} className="btn-secondary px-2 py-1 text-xs">رفض</button>
                  </div>
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
