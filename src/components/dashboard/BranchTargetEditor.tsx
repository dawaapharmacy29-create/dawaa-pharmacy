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

function rowAmount(row?: TargetRow | null) {
  return amount(row?.target_amount ?? row?.monthly_target ?? row?.target);
}

function rowTimestamp(row: TargetRow) {
  const raw = row.updated_at ?? row.created_at ?? '';
  const value = new Date(String(raw)).getTime();
  return Number.isFinite(value) ? value : 0;
}

function newestRow(items: TargetRow[]) {
  return [...items].sort((a, b) => rowTimestamp(b) - rowTimestamp(a))[0];
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
    const { data, error } = await supabase.from('branch_sales_targets').select('*').limit(200);
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
        const matches = loaded.filter((item) => rowBranch(item) === branch);
        const latest = newestRow(matches);
        next[branch] = latest ? String(rowAmount(latest)) : (next[branch] || '');
      }
      return next;
    });
  }, [allowed]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentRows = useMemo(() => BRANCHES.map((branch) => {
    const matches = rows.filter((item) => rowBranch(item) === branch);
    return { branch, row: newestRow(matches), matches };
  }), [rows]);

  const save = async (branch: string, matchingRows: TargetRow[]) => {
    const targetAmount = amount(drafts[branch]);
    if (targetAmount <= 0) {
      toast.error('اكتب تارجت صحيح أكبر من صفر');
      return;
    }

    setSaving(branch);
    try {
      const ids = matchingRows.map((item) => String(item.id || '')).filter(Boolean);
      let writeError: { message?: string } | null = null;

      if (ids.length > 0) {
        const update = await supabase
          .from('branch_sales_targets')
          .update({ target_amount: targetAmount, updated_at: new Date().toISOString() })
          .in('id', ids)
          .select('*');
        writeError = update.error;
      } else {
        const updateByName = await supabase
          .from('branch_sales_targets')
          .update({ target_amount: targetAmount, updated_at: new Date().toISOString() })
          .eq('branch_name', branch)
          .select('*');
        writeError = updateByName.error;

        if (!writeError && (!updateByName.data || updateByName.data.length === 0)) {
          const inserted = await supabase
            .from('branch_sales_targets')
            .insert({ branch_name: branch, target_amount: targetAmount })
            .select('*');
          writeError = inserted.error;
        }
      }

      if (writeError) {
        toast.error(`تعذر حفظ التارجت: ${writeError.message || 'خطأ غير معروف'}`);
        return;
      }

      const verification = await supabase.from('branch_sales_targets').select('*').limit(200);
      if (verification.error) {
        toast.error(`تم إرسال التعديل لكن تعذر التحقق منه: ${verification.error.message}`);
        return;
      }

      const verifiedRows = ((verification.data || []) as TargetRow[])
        .filter((item) => rowBranch(item) === branch);
      const exactMatch = verifiedRows.find((item) => rowAmount(item) === targetAmount);

      if (!exactMatch) {
        const readValues = [...new Set(verifiedRows.map(rowAmount))].filter((value) => value > 0);
        toast.error(`لم يتم تثبيت القيمة الجديدة. القيم المقروءة حاليًا: ${readValues.length ? readValues.map((value) => value.toLocaleString('ar-EG')).join('، ') : 'لا توجد قيمة'}`);
        return;
      }

      clearDashboardCache();
      localStorage.setItem('dawaa_branch_target_refresh', String(Date.now()));
      window.dispatchEvent(new CustomEvent('dawaa:branch-target-updated', { detail: { branch, targetAmount } }));

      setRows((current) => {
        const others = current.filter((item) => rowBranch(item) !== branch);
        return [...others, ...verifiedRows];
      });
      setDrafts((current) => ({ ...current, [branch]: String(targetAmount) }));
      toast.success(`تم حفظ تارجت ${branch}: ${targetAmount.toLocaleString('ar-EG')} جنيه`);
    } finally {
      setSaving(null);
    }
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
        {currentRows.map(({ branch, row, matches }) => (
          <div key={branch} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-black">{branch}</div>
              {matches.length > 1 && <span className="rounded-lg bg-amber-500/15 px-2 py-1 text-[10px] font-black text-amber-200">تم توحيد {matches.length} سجلات</span>}
            </div>
            <div className="mt-3 flex gap-2">
              <input type="number" min="1" step="1000" value={drafts[branch] ?? ''} onChange={(event) => setDrafts((current) => ({ ...current, [branch]: event.target.value }))} placeholder="اكتب تارجت الدورة بالجنيه" className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-950/70 px-3 py-2 font-bold text-white outline-none focus:border-teal-400" />
              <button type="button" onClick={() => void save(branch, matches)} disabled={saving === branch} className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 font-black text-slate-950 disabled:opacity-50">
                <Save className="h-4 w-4" /> {saving === branch ? 'حفظ...' : 'حفظ'}
              </button>
            </div>
            <p className="mt-2 text-xs font-bold text-slate-400">القيمة المحفوظة: {row ? `${rowAmount(row).toLocaleString('ar-EG')} جنيه` : 'لم يتم تحديدها'}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
