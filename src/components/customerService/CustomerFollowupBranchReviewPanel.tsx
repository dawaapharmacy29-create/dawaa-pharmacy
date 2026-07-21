import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search, Store } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { supabase } from '@/lib/supabase';

const VALID_BRANCHES = ['فرع الشامي', 'فرع شكري'] as const;
const FETCH_BATCH = 1000;

type BranchName = (typeof VALID_BRANCHES)[number];

type ReviewRow = {
  id: string;
  customer_name: string | null;
  name: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  phone: string | null;
  branch: string | null;
  created_at: string | null;
};

const text = (value: unknown) => String(value ?? '').trim();
const displayName = (row: ReviewRow) => text(row.customer_name || row.name || 'عميل غير مسجل');
const displayPhone = (row: ReviewRow) => text(row.customer_phone || row.phone || 'بدون هاتف');
const requiresReview = (row: ReviewRow) => !VALID_BRANCHES.includes(normalizeBranchName(row.branch || '') as BranchName);

export default function CustomerFollowupBranchReviewPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedBranches, setSelectedBranches] = useState<Record<string, BranchName | ''>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const collected: ReviewRow[] = [];
      for (let start = 0; ; start += FETCH_BATCH) {
        const { data, error } = await supabase
          .from('daily_followups')
          .select('id,customer_name,name,customer_code,customer_phone,phone,branch,created_at')
          .eq('is_hidden', false)
          .is('completed_at', null)
          .order('created_at', { ascending: false })
          .range(start, start + FETCH_BATCH - 1);
        if (error) throw error;
        const batch = (data || []) as ReviewRow[];
        collected.push(...batch.filter(requiresReview));
        if (batch.length < FETCH_BATCH) break;
      }
      setRows(collected);
    } catch (error) {
      toast.error(`تعذر تحميل مراجعة الفروع: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => `${displayName(row)} ${row.customer_code || ''} ${displayPhone(row)} ${row.branch || ''}`.toLowerCase().includes(query));
  }, [rows, search]);

  const assignBranch = async (row: ReviewRow) => {
    const newBranch = selectedBranches[row.id];
    if (!newBranch) {
      toast.error('اختار الفرع الصحيح أولًا');
      return;
    }

    setSavingId(row.id);
    try {
      const oldBranch = text(row.branch) || 'غير محدد';
      const { error: updateError } = await supabase
        .from('daily_followups')
        .update({ branch: newBranch, updated_by: user?.id || null })
        .eq('id', row.id);
      if (updateError) throw updateError;

      const { error: auditError } = await supabase.from('customer_followup_audit_log').insert({
        followup_id: row.id,
        customer_id: null,
        action: 'branch_review_assigned',
        actor_staff_id: user?.staffId || user?.id || null,
        actor_name: user?.name || null,
        branch: newBranch,
        metadata: { old_branch: oldBranch, new_branch: newBranch, source: 'manual_branch_review' },
      });
      if (auditError) throw auditError;

      toast.success(`تم إسناد المتابعة إلى ${newBranch}`);
      setRows((current) => current.filter((item) => item.id !== row.id));
      setSelectedBranches((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      window.dispatchEvent(new CustomEvent('customer-followup-updated'));
    } catch (error) {
      toast.error(`تعذر حفظ الفرع: ${(error as Error).message}`);
      await load();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="space-y-4 rounded-3xl border border-amber-400/25 bg-[#211b12] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-amber-300"><AlertTriangle className="h-5 w-5" /><span className="text-xs font-black">مراجعة إدارية محكومة</span></div>
          <h3 className="mt-1 text-xl font-black text-white">متابعات تحتاج تحديد الفرع</h3>
          <p className="mt-1 text-sm font-bold text-amber-100/65">لا يتم نقل أي عميل تلقائيًا. المدير يراجع كل حالة ويختار الفرع الصحيح صراحةً.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-2 text-sm font-black text-amber-200">{rows.length} حالة</span>
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-2xl border border-white/10 bg-white/5 p-2.5 text-white hover:bg-white/10 disabled:opacity-50" aria-label="تحديث">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <label className="relative block">
        <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الكود أو الهاتف أو القيمة الحالية للفرع" className="w-full rounded-2xl border border-white/10 bg-black/20 py-3 pl-4 pr-12 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-amber-400/50" />
      </label>

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-amber-200"><Loader2 className="h-5 w-5 animate-spin" /><span className="font-black">جارٍ تحميل الحالات…</span></div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 py-10 text-emerald-200">
          <CheckCircle2 className="h-8 w-8" />
          <span className="font-black">لا توجد حالات تحتاج مراجعة فرع ضمن البحث الحالي</span>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {filteredRows.map((row) => (
            <article key={row.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-black text-white">{displayName(row)}</h4>
                  <p className="mt-1 text-xs font-bold text-slate-400">كود: {row.customer_code || 'غير مسجل'} · هاتف: {displayPhone(row)}</p>
                </div>
                <span className="rounded-xl bg-rose-500/15 px-3 py-1 text-xs font-black text-rose-200">الحالي: {text(row.branch) || 'غير محدد'}</span>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <label className="relative flex-1">
                  <Store className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <select value={selectedBranches[row.id] || ''} onChange={(event) => setSelectedBranches((current) => ({ ...current, [row.id]: event.target.value as BranchName }))} className="w-full rounded-xl border border-white/10 bg-[#171d26] py-2.5 pl-3 pr-9 text-sm font-black text-white outline-none focus:border-amber-400/50">
                    <option value="">اختار الفرع الصحيح</option>
                    {VALID_BRANCHES.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => void assignBranch(row)} disabled={savingId === row.id || !selectedBranches[row.id]} className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40">
                  {savingId === row.id ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'اعتماد الفرع'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
