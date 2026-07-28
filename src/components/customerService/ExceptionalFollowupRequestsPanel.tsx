import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Clock3, RefreshCw, Sparkles, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';

interface ExceptionalRequestRow {
  id: string;
  customer_name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  branch?: string | null;
  priority?: string | null;
  followup_reason?: string | null;
  request_details?: string | null;
  notes?: string | null;
  created_by_name?: string | null;
  requested_by_name?: string | null;
  created_at?: string | null;
  next_followup_date?: string | null;
  assigned_doctor?: string | null;
  responsible_name?: string | null;
  followup_status?: string | null;
  status?: string | null;
  customer_rating?: number | null;
  request_category?: string | null;
}

function valueFromNotes(row: ExceptionalRequestRow, key: string) {
  const source = `${row.request_details || ''}\n${row.notes || ''}`;
  const match = source.match(new RegExp(`${key}:\\s*([^\\n|]+)`, 'i'));
  return match?.[1]?.trim() || '';
}

function ratingOf(row: ExceptionalRequestRow) {
  const direct = Number(row.customer_rating || 0);
  if (direct >= 1 && direct <= 4) return direct;
  const parsed = Number(valueFromNotes(row, 'customer_rating'));
  return parsed >= 1 && parsed <= 4 ? parsed : 0;
}

export default function ExceptionalFollowupRequestsPanel({ onCreate }: { onCreate: () => void }) {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [rows, setRows] = useState<ExceptionalRequestRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('daily_followups')
        .select('*')
        .or('request_type.eq.exceptional_followup,source.eq.exceptional_followup')
        .is('completed_at', null)
        .is('cancelled_at', null)
        .order('created_at', { ascending: false })
        .limit(250);
      if (!managerView && userBranch) query = query.eq('branch', userBranch);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as ExceptionalRequestRow[]);
    } catch (error) {
      toast.error(`تعذر تحميل طلبات المتابعة الاستثنائية: ${(error as Error).message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [managerView, userBranch]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('customer-followup-updated', refresh);
    return () => window.removeEventListener('customer-followup-updated', refresh);
  }, [load]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => ratingOf(b) - ratingOf(a) || Date.parse(String(b.created_at || '')) - Date.parse(String(a.created_at || ''))),
    [rows]
  );

  return (
    <section className="mx-4 rounded-3xl border border-amber-300/20 bg-[#091b2d] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2"><Sparkles className="text-amber-300" size={20}/><h2 className="text-xl font-black text-white">طلبات المتابعات الاستثنائية</h2></div>
          <p className="mt-1 text-sm font-bold text-slate-400">طلبات الدكاترة للعملاء المهمين، مرتبة حسب تقييم العميل ثم تاريخ الطلب.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>تحديث</button>
          <button type="button" onClick={onCreate} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-slate-950">+ طلب استثنائي جديد</button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {sorted.map((row) => {
          const rating = ratingOf(row);
          const category = row.request_category || valueFromNotes(row, 'request_category') || row.followup_reason || 'متابعة استثنائية';
          const requester = row.requested_by_name || row.created_by_name || 'غير محدد';
          return (
            <article key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-black text-white">{row.customer_name || 'عميل بدون اسم'}</h3><p className="mt-1 text-xs text-slate-400">{row.customer_code || 'بدون كود'} · {row.customer_phone || 'بدون هاتف'} · {row.branch || 'غير محدد'}</p></div>
                <span className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-sm font-black text-amber-200">{rating ? `${rating}/4` : 'غير مقيم'}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-black"><span className="rounded-full bg-cyan-400/10 px-3 py-1 text-cyan-200">{category}</span><span className="rounded-full bg-white/5 px-3 py-1 text-slate-300">{row.priority || 'عاجل'}</span></div>
              <p className="mt-3 whitespace-pre-wrap text-sm font-bold leading-7 text-slate-200">{row.request_details || row.notes || 'لا توجد ملاحظات'}</p>
              <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2"><span className="flex items-center gap-2"><UserRound size={14}/>مقدم الطلب: <b className="text-slate-200">{requester}</b></span><span className="flex items-center gap-2"><Clock3 size={14}/>{row.created_at ? new Date(row.created_at).toLocaleString('ar-EG') : '-'}</span><span className="flex items-center gap-2"><AlertCircle size={14}/>المسؤول: <b className="text-slate-200">{row.assigned_doctor || row.responsible_name || 'حسب الفرع'}</b></span><span>الحالة: <b className="text-slate-200">{row.followup_status || row.status || 'جديد'}</b></span></div>
            </article>
          );
        })}
      </div>
      {!loading && sorted.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm font-bold text-slate-400">لا توجد طلبات متابعة استثنائية مفتوحة حاليًا.</div> : null}
    </section>
  );
}
