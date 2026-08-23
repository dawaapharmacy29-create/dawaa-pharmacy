import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';

const ALL_BRANCHES = 'كل الفروع';

type Stats = {
  open: number;
  waiting: number;
  no_answer: number;
  overdue: number;
  manager_needed: number;
  bad_data: number;
};

const EMPTY: Stats = {
  open: 0,
  waiting: 0,
  no_answer: 0,
  overdue: 0,
  manager_needed: 0,
  bad_data: 0,
};

export default function CustomerServiceCommandOverview() {
  const { user } = useAuth();
  const manager = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(manager ? ALL_BRANCHES : userBranch);
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!manager && !userBranch) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_cs_command_overview_v1', {
        p_branch: branch === ALL_BRANCHES ? null : branch,
      });
      if (rpcError) throw rpcError;
      const row = (data || {}) as Partial<Stats>;
      setStats({
        open: Number(row.open || 0),
        waiting: Number(row.waiting || 0),
        no_answer: Number(row.no_answer || 0),
        overdue: Number(row.overdue || 0),
        manager_needed: Number(row.manager_needed || 0),
        bad_data: Number(row.bad_data || 0),
      });
    } catch (loadError) {
      console.error('[CustomerServiceCommandOverview] load failed', loadError);
      setError('تعذر تحميل ملخص مركز القيادة. باقي الصفحة ستستمر في العمل.');
    } finally {
      setLoading(false);
    }
  }, [branch, manager, userBranch]);

  useEffect(() => { void load(); }, [load]);

  const cards = [
    ['مفتوح الآن', stats.open, Clock3],
    ['انتظار رد', stats.waiting, MessageCircle],
    ['لم يرد', stats.no_answer, AlertTriangle],
    ['متأخر', stats.overdue, Clock3],
    ['يحتاج مديرًا', stats.manager_needed, AlertTriangle],
    ['مراجعة بيانات', stats.bad_data, DatabaseZap],
  ] as const;

  return (
    <section className="dawaa-card dawaa-card--raised mx-4 mt-4 p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="dawaa-title text-xl">مركز قيادة خدمة العملاء</h2>
          <p className="dawaa-caption mt-1 text-xs font-bold">ملخص حي من السيرفر للحالات المفتوحة والمتأخرة وجودة البيانات بدون تحميل قائمة العملاء كاملة.</p>
        </div>
        <div className="flex gap-2">
          {manager ? (
            <select className="dawaa-select" value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option>{ALL_BRANCHES}</option>
              <option>فرع الشامي</option>
              <option>فرع شكري</option>
            </select>
          ) : (
            <div className="dawaa-input font-black">{userBranch}</div>
          )}
          <button className="dawaa-button dawaa-button--secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
          </button>
        </div>
      </div>

      {error ? <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs font-bold"><AlertTriangle size={16} />{error}</div> : null}

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, value, Icon]) => (
          <div key={label} className="dawaa-card dawaa-card--soft p-3">
            <div className="dawaa-icon-tile h-8 w-8"><Icon size={17} /></div>
            <div className="dawaa-caption mt-2 text-xs font-black">{label}</div>
            <div className="dawaa-title text-2xl">{value}</div>
          </div>
        ))}
      </div>

      {!loading && !error && stats.overdue === 0 && stats.manager_needed === 0 ? (
        <div className="dawaa-alert dawaa-alert--success mt-3 text-xs font-black"><CheckCircle2 size={16} /> لا توجد حالات متأخرة أو تصعيد مدير في النطاق الحالي.</div>
      ) : null}
    </section>
  );
}
