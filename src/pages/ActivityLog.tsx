import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Database, ExternalLink, RefreshCw, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BRANCHES } from '@/lib/constants';
import { formatDateTime } from '@/lib/utils';
import { formatActivityDetails } from '@/lib/activityLog';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useDebounce } from '@/hooks/useDebounce';
import { useEscapeKey } from '@/hooks/useEscapeKey';

type ActivityLogEntry = {
  id: string;
  user_id?: string | null;
  user_name?: string | null;
  user_role?: string | null;
  operation?: string | null;
  action?: string | null;
  module?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_title?: string | null;
  details?: string | Record<string, unknown> | null;
  branch?: string | null;
  branch_name?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  route_path?: string | null;
  created_at: string;
};

type ActivityPage = {
  rows: ActivityLogEntry[];
  total: number;
  today_count: number;
  week_count: number;
  unique_users: number;
  source: string;
};

const ALL = 'الكل';
const PAGE_SIZE = 100;

function text(value: unknown, fallback = '') {
  return value === undefined || value === null ? fallback : String(value);
}

function branchOf(row: ActivityLogEntry) {
  return text(row.branch_name || row.branch, 'غير محدد');
}

function actionOf(row: ActivityLogEntry) {
  return text(row.operation || row.action, 'عملية');
}

function moduleOf(row: ActivityLogEntry) {
  return text(row.module || row.entity_type, 'النظام');
}

export default function ActivityLog() {
  const navigate = useNavigate();
  const requestIdRef = useRef(0);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [branch, setBranch] = useState(ALL);
  const [moduleFilter, setModuleFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<ActivityPage>({
    rows: [], total: 0, today_count: 0, week_count: 0, unique_users: 0, source: 'activity_log',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ActivityLogEntry | null>(null);

  useEscapeKey(() => setSelected(null), Boolean(selected));

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_activity_log_page_v1', {
        p_search: debouncedSearch.trim() || null,
        p_branch: branch === ALL ? null : branch,
        p_module: moduleFilter.trim() || null,
        p_user: userFilter.trim() || null,
        p_action: actionFilter.trim() || null,
        p_date_from: dateFrom || null,
        p_offset: page * PAGE_SIZE,
        p_limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;
      if (rpcError) throw rpcError;
      const next = (data || {}) as ActivityPage;
      setResult({
        rows: Array.isArray(next.rows) ? next.rows : [],
        total: Number(next.total || 0),
        today_count: Number(next.today_count || 0),
        week_count: Number(next.week_count || 0),
        unique_users: Number(next.unique_users || 0),
        source: String(next.source || 'activity_log'),
      });
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setResult((current) => ({ ...current, rows: [] }));
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل سجل الأنشطة.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [actionFilter, branch, dateFrom, debouncedSearch, moduleFilter, page, userFilter]);

  useEffect(() => {
    setPage(0);
  }, [actionFilter, branch, dateFrom, debouncedSearch, moduleFilter, userFilter]);

  useEffect(() => {
    void load();
    return () => { requestIdRef.current += 1; };
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const moduleSuggestions = useMemo(() => [...new Set(result.rows.map(moduleOf).filter(Boolean))], [result.rows]);
  const userSuggestions = useMemo(() => [...new Set(result.rows.map((row) => text(row.user_name)).filter(Boolean))], [result.rows]);
  const actionSuggestions = useMemo(() => [...new Set(result.rows.map(actionOf).filter(Boolean))], [result.rows]);

  if (!isSupabaseConfigured) {
    return <div className="dawaa-empty-state py-16 text-center">فعّل Supabase لمشاهدة سجل الأنشطة الحقيقي.</div>;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="dawaa-card dawaa-card--soft">
        <div className="flex items-center gap-3 text-sm">
          <span className="dawaa-icon-tile h-10 w-10 shrink-0"><Database className="h-5 w-5" /></span>
          <div className="dawaa-body flex-1">
            سجل موحّد من <span className="dawaa-heading font-mono font-black">activity_log</span> مع بحث وفلاتر Server-side على كامل التاريخ، بدون fallback للجدول القديم الفارغ.
          </div>
          <button type="button" onClick={() => void load()} className="dawaa-button dawaa-button--secondary" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      {error ? <div className="dawaa-alert dawaa-alert--danger text-sm font-bold">{error}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="مطابق للفلاتر" value={result.total} />
        <Stat label="اليوم" value={result.today_count} />
        <Stat label="آخر 7 أيام" value={result.week_count} />
        <Stat label="مستخدمون مختلفون" value={result.unique_users} />
      </section>

      <section className="dawaa-card grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <label className="relative xl:col-span-2">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input className="dawaa-input w-full pr-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث في المستخدم، العملية، الهدف أو التفاصيل..." />
        </label>
        <select className="dawaa-select" value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value={ALL}>كل الفروع</option>
          {BRANCHES.map((item) => <option key={item}>{item}</option>)}
        </select>
        <input list="activity-modules" className="dawaa-input" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} placeholder="الموديول" />
        <input list="activity-users" className="dawaa-input" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="المستخدم" />
        <input list="activity-actions" className="dawaa-input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} placeholder="العملية" />
        <datalist id="activity-modules">{moduleSuggestions.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="activity-users">{userSuggestions.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="activity-actions">{actionSuggestions.map((v) => <option key={v} value={v} />)}</datalist>
        <input type="date" className="dawaa-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
      </section>

      <section className="dawaa-card overflow-hidden p-0">
        {loading && !result.rows.length ? (
          <div className="py-16 text-center text-slate-400"><RefreshCw className="mx-auto mb-3 animate-spin" /> جاري التحميل...</div>
        ) : !result.rows.length ? (
          <div className="dawaa-empty-state py-16 text-center">لا توجد سجلات مطابقة للفلاتر الحالية.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--dawaa-theme-border)] text-right text-slate-500">
                  {['الوقت','المستخدم','الموديول','العملية','الفرع','التفاصيل'].map((h) => <th key={h} className="p-3">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--dawaa-theme-border)]/60 hover:bg-white/5">
                    <td className="whitespace-nowrap p-3 text-xs text-slate-400">{formatDateTime(row.created_at)}</td>
                    <td className="p-3"><div className="font-bold">{row.user_name || 'النظام'}</div><div className="text-xs text-slate-500">{row.user_role || ''}</div></td>
                    <td className="p-3"><span className="dawaa-badge dawaa-badge--info">{moduleOf(row)}</span></td>
                    <td className="p-3 font-bold">{actionOf(row)}</td>
                    <td className="p-3">{branchOf(row)}</td>
                    <td className="p-3">
                      <button type="button" onClick={() => setSelected(row)} className="dawaa-button dawaa-button--ghost text-xs">
                        <Activity size={14} /> عرض
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-500">صفحة {page + 1} من {pageCount} · {result.total.toLocaleString('ar-EG')} سجل</div>
        <div className="flex gap-2">
          <button type="button" className="dawaa-button dawaa-button--secondary" disabled={page <= 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>السابق</button>
          <button type="button" className="dawaa-button dawaa-button--secondary" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>التالي</button>
        </div>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.currentTarget === e.target) setSelected(null); }}>
          <div className="dawaa-card max-h-[85vh] w-full max-w-3xl overflow-y-auto">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="dawaa-title text-lg">{actionOf(selected)}</div>
                <div className="mt-1 text-xs text-slate-500">{formatDateTime(selected.created_at)} · {selected.user_name || 'النظام'}</div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="dawaa-button dawaa-button--ghost"><X size={16} /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="الموديول" value={moduleOf(selected)} />
              <Detail label="الفرع" value={branchOf(selected)} />
              <Detail label="نوع الهدف" value={text(selected.target_type || selected.entity_type, '—')} />
              <Detail label="معرف الهدف" value={text(selected.target_id || selected.entity_id, '—')} />
            </div>
            <div className="mt-4 rounded-2xl bg-black/10 p-4 text-sm leading-7 whitespace-pre-wrap">{formatActivityDetails(selected.details) || 'لا توجد تفاصيل إضافية.'}</div>
            {selected.route_path?.startsWith('/') ? (
              <button type="button" onClick={() => navigate(selected.route_path!)} className="dawaa-button dawaa-button--primary mt-4">
                <ExternalLink size={15} /> فتح الصفحة المرتبطة
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat-card"><div className="text-xs font-bold text-slate-500">{label}</div><div className="num mt-2 text-2xl font-black">{Number(value || 0).toLocaleString('ar-EG')}</div></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 break-all text-sm font-bold">{value}</div></div>;
}
