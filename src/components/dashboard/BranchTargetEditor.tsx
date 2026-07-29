import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, Target } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { formatCycleDate, getCurrentCycle } from '@/lib/pharmacy-cycle';
import { clearDashboardCache } from '@/lib/dashboard/dashboardOptimizations';

const BRANCHES = ['فرع الشامي', 'فرع شكري'] as const;
type TargetRow = Record<string, unknown>;

function amount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowBranch(row: TargetRow) {
  return normalizeBranchName(String(row.branch_name ?? row.branch ?? ''));
}

function canManage(role: unknown) {
  const value = String(role || '').toLowerCase();
  return ['general_manager', 'admin', 'manager', 'branch_manager', 'area_manager'].some((item) => value.includes(item));
}

export default function BranchTargetEditor({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const cycle = getCurrentCycle();
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const allowed = canManage(user?.role);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    const { data, error } = await supabase.from('branch_sales_targets').select('*').limit(100);
    setLoading(false);
    if (error) {
      toast.error(`تعذر تحميل التارجت: ${error.message}`);
      return;
    }
    const loaded = Array.isArray(data) ? (data as TargetRow[]) : [];
    setRows(loaded);
    setDrafts((current) => {
      const next = { ...current };
      for (const branch of BRANCHES) {
        const row = loaded.find((item) => rowBranch(item) === branch);
        next[branch] = row ? String(amount(row.target_amount ?? row.monthly_target ?? row.target)) : (next[branch] || '');
      }
      return next;
    });
  }, [allowed]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentRows = useMemo(() => BRANCHES.map((branch) => ({
    branch,
    row: rows.find((item) => rowBranch(item) === branch),
  })), [rows]);

  const save = async (branch: string, existing?: TargetRow) => {
    const targetAmount = amount(drafts[branch]);
    if (targetAmount <= 0) {
      toast.error('اكتب تارجت صحيح أكبر من صفر');
      return;
    }

    setSaving(branch);
    const minimalPayload = { branch_name: branch, target_amount: targetAmount };
    let writeError: { message?: string } | null = null;
    let returnedRows: TargetRow[] = [];

    if (existing?.id) {
      const result = await supabase
        .from('branch_sales_targets')
        .update({ target_amount: targetAmount })
        .eq('id', String(existing.id))
        .select('*');
      writeError = result.error;
      returnedRows = Array.isArray(result.data) ? (result.data as TargetRow[]) : [];
    } else {
      const updateByBranch = await supabase
        .from('branch_sales_targets')
        .update({ target_amount: targetAmount })
        .eq('branch_name', branch)
        .select('*');
      writeError = updateByBranch.error;
      returnedRows = Array.isArray(updateByBranch.data) ? (updateByBranch.data as TargetRow[]) : [];

      if (!writeError && returnedRows.length === 0) {
        const inserted = await supabase.from('branch_sales_targets').insert(minimalPayload).select('*');
        writeError = inserted.error;
        returnedRows = Array.isArray(inserted.data) ? (inserted.data as TargetRow[]) : [];
      }
    }

    if (writeError) {
      setSaving(null);
      toast.error(`تعذر حفظ التارجت: ${writeError.message || 'خطأ غير معروف'}`);
      return;
    }

    let verified = returnedRows.find((item) => rowBranch(item) === branch);

    if (!verified) {
      const verification = existing?.id
        ? await supabase.from('branch_sales_targets').select('*').eq('id', String(existing.id)).limit(1)
        : await supabase.from('branch_sales_targets').select('*').limit(100);

      if (!verification.error && Array.isArray(verification.data)) {
        verified = (verification.data as TargetRow[]).find((item) => rowBranch(item) === branch);
      }
    }

    setSaving(null);
    const verifiedAmount = amount(verified?.target_amount ?? verified?.monthly_target ?? verified?.target);

    if (verified && verifiedAmount !== targetAmount) {
      toast.error('تم الحفظ لكن القيمة المقروءة لا تطابق التعديل. اضغط تحديث وأعد المحاولة.');
      return;
    }

    clearDashboardCache();
    localStorage.setItem('dawaa_branch_target_refresh', String(Date.now()));
    window.dispatchEvent(new CustomEvent('dawaa:branch-target-updated', { detail: { branch, targetAmount } }));

    setRows((current) => {
      const nextRow = verified || { ...(existing || {}), ...minimalPayload };
      const index = current.findIndex((item) => rowBranch(item) === branch);
      if (index === -1) return [...current, nextRow];
      return current.map((item, itemIndex) => itemIndex === index ? { ...item, ...nextRow, target_amount: targetAmount } : item);
    });

    toast.success(`تم حفظ تارجت ${branch}: ${targetAmount.toLocaleString('ar-EG')} جنيه`);
    await load();
  };

  if (!allowed) return null;

  return (
    <section id="branch-target-editor" dir="rtl" className={`rounded-3xl border border-teal-300/25 bg-slate-900/85 text-white shadow-lg ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Target className="h-5 w-5 text-teal-300" /><h2 className="text-lg font-black">تعديل تارجت الفروع</h2></div>
          <p className="mt-1 text-xs font-bold text-slate-400">دورة {formatCycleDate(cycle.start)} إلى {formatCycleDate(cycle.end)} — يبدأ التارجت يوم 26 من كل شهر.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-teal-300/25 bg-teal-400/10 px-3 py-2 text-xs font-black text-teal-100 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {currentRows.map(({ branch, row }) => (
          <div key={branch} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="font-black">{branch}</div>
            <div className="mt-3 flex gap-2">
              <input type="number" min="1" step="1000" value={drafts[branch] ?? ''} onChange={(event) => setDrafts((current) => ({ ...current, [branch]: event.target.value }))} placeholder="اكتب تارجت الدورة بالجنيه" className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-950/70 px-3 py-2 font-bold text-white outline-none focus:border-teal-400" />
              <button type="button" onClick={() => void save(branch, row)} disabled={saving === branch} className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 font-black text-slate-950 disabled:opacity-50">
                <Save className="h-4 w-4" /> {saving === branch ? 'حفظ...' : 'حفظ'}
              </button>
            </div>
            <p className="mt-2 text-xs font-bold text-slate-400">القيمة المحفوظة: {row ? `${amount(row.target_amount ?? row.monthly_target ?? row.target).toLocaleString('ar-EG')} جنيه` : 'لم يتم تحديدها'}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
