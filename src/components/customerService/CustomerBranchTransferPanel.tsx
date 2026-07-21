import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';

const ALL_BRANCHES = 'كل الفروع';
const BRANCHES = ['فرع الشامي', 'فرع شكري'] as const;

type FollowupRow = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  phone: string | null;
  branch: string | null;
  status: string | null;
  followup_status: string | null;
  created_at: string | null;
};

type TransferResult = {
  from_branch?: string;
  to_branch?: string;
  followups_updated?: number;
  queue_items_updated?: number;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function customerName(row: FollowupRow) {
  return text(row.customer_name || row.name || 'عميل غير مسجل');
}

function customerPhone(row: FollowupRow) {
  return text(row.customer_phone || row.phone);
}

function otherBranch(branch: string) {
  return normalizeBranchName(branch) === 'فرع شكري' ? 'فرع الشامي' : 'فرع شكري';
}

export default function CustomerBranchTransferPanel() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FollowupRow | null>(null);
  const [targetBranch, setTargetBranch] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!managerView && !userBranch) return;
    setLoading(true);
    try {
      let query = supabase
        .from('daily_followups')
        .select('id,customer_id,customer_name,name,customer_code,customer_phone,phone,branch,status,followup_status,created_at')
        .eq('is_hidden', false)
        .is('completed_at', null)
        .order('created_at', { ascending: false })
        .limit(300);
      if (branch !== ALL_BRANCHES) query = query.eq('branch', branch);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as FollowupRow[]);
    } catch (error) {
      toast.error(`تعذر تحميل العملاء للتحويل: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [branch, managerView, userBranch]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows.slice(0, 18);
    return rows
      .filter((row) =>
        `${customerName(row)} ${row.customer_code || ''} ${customerPhone(row)} ${row.branch || ''}`
          .toLowerCase()
          .includes(query)
      )
      .slice(0, 30);
  }, [rows, search]);

  function openTransfer(row: FollowupRow) {
    const current = normalizeBranchName(row.branch || '');
    setSelected(row);
    setTargetBranch(otherBranch(current));
    setReason(current ? `بيانات العميل تتبع ${otherBranch(current)}` : 'تصحيح فرع العميل');
  }

  async function transfer() {
    if (!selected || !targetBranch) return;
    const current = normalizeBranchName(selected.branch || '');
    if (current === targetBranch) {
      toast.error('العميل موجود بالفعل في الفرع المطلوب');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('transfer_customer_followup_branch_v1', {
        p_followup_id: selected.id,
        p_target_branch: targetBranch,
        p_actor_staff_id: user?.staffId || user?.id || null,
        p_actor_name: user?.name || null,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
      const result = (data || {}) as TransferResult;
      toast.success(
        `تم التحويل إلى ${result.to_branch || targetBranch} وتحديث ${Number(result.followups_updated || 0)} متابعة`
      );
      setRows((currentRows) => currentRows.filter((row) => row.id !== selected.id));
      setSelected(null);
      setReason('');
      window.dispatchEvent(
        new CustomEvent('customer-followup-branch-transferred', {
          detail: { followupId: selected.id, fromBranch: current, toBranch: targetBranch },
        })
      );
      await load();
    } catch (error) {
      toast.error(`تعذر تحويل العميل: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!managerView && !userBranch) return null;

  return (
    <section className="mx-4 mt-4 space-y-4 rounded-3xl border border-violet-400/20 bg-[#10243d] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-white">
            <ArrowLeftRight className="text-violet-300" /> تحويل العميل للفرع الصحيح
          </h2>
          <p className="mt-1 text-sm font-bold text-slate-400">
            التحويل يحدّث المتابعات المفتوحة والقائمة اليومية ويسجل العملية باسم الدكتورة.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {managerView ? (
            <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option>{ALL_BRANCHES}</option>
              {BRANCHES.map((item) => <option key={item}>{item}</option>)}
            </select>
          ) : (
            <div className="input-dark font-black text-violet-100">{userBranch}</div>
          )}
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} تحديث
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={17} className="absolute right-3 top-3 text-slate-400" />
        <input
          className="input-dark w-full pr-10"
          placeholder="ابحث باسم العميل أو الكود أو الهاتف"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
        {visibleRows.map((row) => {
          const current = normalizeBranchName(row.branch || '');
          const target = otherBranch(current);
          return (
            <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="font-black text-white">{customerName(row)}</div>
              <div className="mt-1 text-xs font-bold text-slate-400">
                {row.customer_code || 'بدون كود'} · {customerPhone(row) || 'بدون هاتف'}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-black text-cyan-200">
                  {current || 'فرع غير محدد'}
                </span>
                <button type="button" className="btn-secondary flex items-center gap-1 text-xs" onClick={() => openTransfer(row)}>
                  <ArrowLeftRight size={14} /> تحويل إلى {target.replace('فرع ', '')}
                </button>
              </div>
            </article>
          );
        })}
        {!loading && visibleRows.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-6 text-center font-black text-emerald-200">
            <CheckCircle2 className="mx-auto mb-2" /> لا توجد نتائج مطابقة
          </div>
        ) : null}
      </div>

      {selected ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-[#10243d] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-white">تأكيد تحويل العميل</h3>
                <p className="mt-1 text-sm font-bold text-slate-400">{customerName(selected)}</p>
              </div>
              <button type="button" className="rounded-xl p-2 text-slate-300 hover:bg-white/10" onClick={() => setSelected(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4 text-sm font-black text-violet-100">
              {normalizeBranchName(selected.branch || '') || 'فرع غير محدد'} ← {targetBranch}
            </div>
            <label className="mt-4 block text-sm font-black text-slate-200">
              سبب التحويل
              <textarea className="input-dark mt-2 min-h-24 w-full" value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>رجوع</button>
              <button type="button" className="btn-primary flex items-center gap-2" onClick={() => void transfer()} disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <ArrowLeftRight size={16} />}
                تأكيد التحويل إلى {targetBranch.replace('فرع ', '')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
