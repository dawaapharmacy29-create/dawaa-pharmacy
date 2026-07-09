import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { Activity, Database, Search, ExternalLink, X, AlertCircle, CheckCircle2, ChevronDown } from 'lucide-react';
import { BRANCHES } from '@/lib/constants';
import { formatDateTime, matchesOrderedSegments } from '@/lib/utils';
import { formatActivityDetails } from '@/lib/activityLog';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';

interface ActivityLogEntry {
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
  branch_id?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  route_path?: string | null;
  created_at: string;
}

const ALL = 'الكل';

const MODULE_COLORS: Record<string, string> = {
  النظام: 'badge-info',
  النقاط: 'badge-success',
  العملاء: 'badge-purple',
  'خدمة العملاء': 'badge-info',
  الفواتير: 'badge-warning',
  التوصيل:
    'bg-amber-500/15 border-amber-500/25 text-amber-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border',
  الفريق:
    'bg-purple-500/15 border-purple-500/25 text-purple-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border',
  'تقييم المحادثات': 'badge-info',
  'تقييم الشيفتات': 'badge-warning',
  'أدوية الحوافز':
    'bg-teal-500/15 border-teal-500/25 text-teal-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border',
  'الأدوية الرواكد':
    'bg-red-500/15 border-red-500/25 text-red-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border',
  'حسابات وصلاحيات الفريق':
    'bg-blue-500/15 border-blue-500/25 text-blue-400 text-xs font-semibold px-2.5 py-0.5 rounded-full border',
};

function moduleBadge(moduleName: string) {
  return MODULE_COLORS[moduleName] || 'badge-info';
}

function normalizeSearch(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function safeString(value: unknown, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
}

function logBranch(log: ActivityLogEntry) {
  return safeString(log.branch_name || log.branch, 'غير محدد');
}

function isPermissionDenied(message?: string | null) {
  const value = String(message || '').toLowerCase();
  return value.includes('permission denied') || value.includes('row-level security');
}

function isMissingSource(message?: string | null) {
  const value = String(message || '').toLowerCase();
  return (
    value.includes('does not exist') ||
    value.includes('schema cache') ||
    value.includes('could not find the table')
  );
}

async function readActivitySource(table: 'activity_log' | 'activity_logs') {
  return supabase.from(table).select('*').order('created_at', { ascending: false }).limit(500);
}

export default function ActivityLog() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState(ALL);
  const [moduleFilter, setModuleFilter] = useState(ALL);
  const [userFilter, setUserFilter] = useState(ALL);
  const [actionFilter, setActionFilter] = useState(ALL);
  const [dateFrom, setDateFrom] = useState('');
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceTable, setSourceTable] = useState<'activity_log' | 'activity_logs'>('activity_log');
  const [sourceIssue, setSourceIssue] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<ActivityLogEntry | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const unavailableSourcesRef = useRef(new Set<string>());
  const diagnosticsRef = useRef<{
    primary: { status: 'success' | 'permission' | 'missing' | 'error'; message: string; timestamp: string };
    secondary: { status: 'success' | 'permission' | 'missing' | 'error'; message: string; timestamp: string };
  }>({
    primary: { status: 'error', message: 'لم يتم الفحص بعد', timestamp: '' },
    secondary: { status: 'error', message: 'لم يتم الفحص بعد', timestamp: '' },
  });

  const loadLogs = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLogs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setSourceIssue(null);
    let table: 'activity_log' | 'activity_logs' = 'activity_log';
    const now = new Date().toISOString();

    const primary = unavailableSourcesRef.current.has('activity_log')
      ? { data: null, error: { message: 'source previously unavailable' } }
      : await readActivitySource('activity_log');

    if (!primary.error) {
      diagnosticsRef.current.primary = {
        status: 'success',
        message: `تم قراءة ${(primary.data as any[])?.length || 0} سجل بنجاح`,
        timestamp: now,
      };

      const primaryRows = (primary.data || []) as ActivityLogEntry[];
      if (primaryRows.length > 0) {
        setLogs(primaryRows);
        table = 'activity_log';
      } else {
        const secondary = unavailableSourcesRef.current.has('activity_logs')
          ? { data: null, error: { message: 'source previously unavailable' } }
          : await readActivitySource('activity_logs');

        if (!secondary.error && Array.isArray(secondary.data) && secondary.data.length > 0) {
          setLogs(secondary.data as ActivityLogEntry[]);
          table = 'activity_logs';
          diagnosticsRef.current.secondary = {
            status: 'success',
            message: `الجدول الأساسي فارغ، وتم قراءة ${secondary.data.length} سجل من الجدول البديل`,
            timestamp: now,
          };
          setSourceIssue('الجدول الأساسي activity_log فارغ حاليًا؛ تم العرض من activity_logs مؤقتًا.');
        } else {
          setLogs([]);
          table = 'activity_log';
          diagnosticsRef.current.secondary = secondary.error
            ? { status: isMissingSource(secondary.error.message) ? 'missing' : isPermissionDenied(secondary.error.message) ? 'permission' : 'error', message: secondary.error.message, timestamp: now }
            : { status: 'success', message: 'الجدول البديل متاح لكنه فارغ أيضًا', timestamp: now };
          setSourceIssue('لا توجد سجلات نشاط محفوظة في المصدر الحالي. تأكد أن عمليات التطبيق تستدعي logActivity وأن RLS يسمح بالقراءة.');
        }
      }
    } else {
      let primaryStatus: 'permission' | 'missing' | 'error' = 'error';
      if (isPermissionDenied(primary.error.message)) {
        primaryStatus = 'permission';
        unavailableSourcesRef.current.add('activity_log');
      } else if (isMissingSource(primary.error.message)) {
        primaryStatus = 'missing';
        unavailableSourcesRef.current.add('activity_log');
      }
      diagnosticsRef.current.primary = {
        status: primaryStatus,
        message: primary.error.message,
        timestamp: now,
      };

      const secondary = unavailableSourcesRef.current.has('activity_logs')
        ? { data: null, error: { message: 'source previously unavailable' } }
        : await readActivitySource('activity_logs');

      if (!secondary.error) {
        setLogs((secondary.data || []) as ActivityLogEntry[]);
        table = 'activity_logs';
        diagnosticsRef.current.secondary = {
          status: 'success',
          message: `تم قراءة ${(secondary.data as any[])?.length || 0} سجل من الجدول البديل بنجاح`,
          timestamp: now,
        };
        if (!secondary.data?.length) setSourceIssue('المصدر البديل متاح لكنه فارغ.');
      } else {
        let secondaryStatus: 'permission' | 'missing' | 'error' = 'error';
        if (isPermissionDenied(secondary.error.message)) {
          secondaryStatus = 'permission';
          unavailableSourcesRef.current.add('activity_logs');
        } else if (isMissingSource(secondary.error.message)) {
          secondaryStatus = 'missing';
          unavailableSourcesRef.current.add('activity_logs');
        }
        diagnosticsRef.current.secondary = {
          status: secondaryStatus,
          message: secondary.error.message,
          timestamp: now,
        };

        setLogs([]);
        if (
          diagnosticsRef.current.primary.status === 'permission' ||
          diagnosticsRef.current.secondary.status === 'permission'
        ) {
          setSourceIssue(
            'لا توجد صلاحية قراءة سجل الأنشطة. راجع سياسات RLS في Supabase أو صلاحيات دورك الحالي.'
          );
        } else if (
          diagnosticsRef.current.primary.status === 'missing' &&
          diagnosticsRef.current.secondary.status === 'missing'
        ) {
          setSourceIssue(
            'جدول سجل الأنشطة غير موجود: لم يتم إنشاء activity_log أو activity_logs في قاعدة البيانات.'
          );
        } else {
          setSourceIssue(
            `تعذر قراءة جداول سجل الأنشطة. تفاصيل التشخيص متاحة في لوحة المراقبة.`
          );
        }
      }
    }

    setSourceTable(table);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const users = useMemo(
    () => [
      ALL,
      ...new Set(
        logs
          .map((log) => safeString(log.user_name))
          .filter((value) => value !== '')
      ),
    ],
    [logs]
  );
  const actions = useMemo(
    () => [
      ALL,
      ...new Set(
        logs
          .map((log) => safeString(log.operation || log.action))
          .filter((value) => value !== '')
      ),
    ],
    [logs]
  );
  const modules = useMemo(
    () => [
      ALL,
      ...new Set(
        logs
          .map((log) => safeString(log.module || log.entity_type))
          .filter((value) => value !== '')
      ),
    ],
    [logs]
  );

  const filtered = useMemo(() => {
    const query = normalizeSearch(search);
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : 0;

    return logs.filter((log) => {
      const details = formatActivityDetails(log.details);
      const operation = safeString(log.operation || log.action);
      const module = safeString(log.module || log.entity_type);
      const matchSearch =
        !query ||
        matchesOrderedSegments(safeString(log.user_name), query) ||
        matchesOrderedSegments(safeString(log.user_role), query) ||
        matchesOrderedSegments(operation, query) ||
        matchesOrderedSegments(module, query) ||
        matchesOrderedSegments(safeString(log.target_type), query) ||
        matchesOrderedSegments(safeString(log.target_id), query) ||
        matchesOrderedSegments(safeString(log.entity_type), query) ||
        matchesOrderedSegments(safeString(log.entity_id), query) ||
        matchesOrderedSegments(details, query);
      const matchBranch = branchFilter === ALL || logBranch(log) === branchFilter;
      const matchModule = moduleFilter === ALL || module === moduleFilter;
      const matchUser = userFilter === ALL || safeString(log.user_name) === userFilter;
      const matchAction = actionFilter === ALL || operation === actionFilter;
      const matchDate = !fromTime || new Date(log.created_at).getTime() >= fromTime;
      return matchSearch && matchBranch && matchModule && matchUser && matchAction && matchDate;
    });
  }, [logs, search, branchFilter, moduleFilter, userFilter, actionFilter, dateFrom]);

  const today = new Date().toDateString();

  useEscapeKey(() => setSelectedLog(null), Boolean(selectedLog));

  if (!isSupabaseConfigured) {
    return (
      <div className="stat-card text-center text-slate-400 py-16">
        فعّل Supabase لمشاهدة سجل الأنشطة الحقيقي.
      </div>
    );
  }

  const todayCount = filtered.filter((log) => new Date(log.created_at).toDateString() === today).length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekCount = filtered.filter((log) => new Date(log.created_at).getTime() >= weekAgo).length;
  const uniqueUsers = new Set(filtered.map((log) => log.user_name || log.user_id).filter(Boolean)).size;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="stat-card border-teal-500/30 bg-teal-500/10 text-slate-300">
        <div className="flex items-center gap-3 text-sm">
          <Database className="h-5 w-5 text-teal-400" />
          <span>
            هذا السجل يعرض العمليات المهمة داخل النظام: النقاط، التقييمات، المتابعات، الفواتير، والإجراءات الإدارية.
            مصدر البيانات الحالي: <span className="font-mono text-teal-300">{sourceTable}</span>.
          </span>
        </div>
      </div>

      {sourceIssue && (
        <div className="stat-card border-amber-500/30 bg-amber-500/10 text-amber-100">
          <div className="flex items-center gap-3 text-sm font-bold">
            <AlertCircle className="h-5 w-5" />
            {sourceIssue}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowDiagnostics((value) => !value)}
        className="flex w-full items-center justify-between bg-slate-800/90 px-4 py-3 text-right text-sm font-bold text-slate-200"
      >
        <span>لوحة التشخيص للمسؤولين</span>
        <ChevronDown className={`h-4 w-4 transition ${showDiagnostics ? 'rotate-180' : ''}`} />
      </button>

      {showDiagnostics && (
        <div className="grid gap-3 md:grid-cols-2">
          {(['primary', 'secondary'] as const).map((key) => (
            <div key={key} className="stat-card">
              <div className="mb-2 flex items-center gap-2 text-sm font-black text-white">
                {diagnosticsRef.current[key].status === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertCircle className="h-4 w-4 text-amber-400" />}
                {key === 'primary' ? 'activity_log' : 'activity_logs'}
              </div>
              <p className="text-xs leading-6 text-slate-400">{diagnosticsRef.current[key].message}</p>
              <p className="mt-2 text-[11px] text-slate-500">{diagnosticsRef.current[key].timestamp}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="إجمالي السجلات" value={filtered.length} tone="white" />
        <Stat label="اليوم" value={todayCount} tone="teal" />
        <Stat label="هذا الأسبوع" value={weekCount} tone="blue" />
        <Stat label="مستخدمون" value={uniqueUsers} tone="purple" />
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-700/60 bg-[#101d33] p-3 md:grid-cols-6">
        <div className="relative md:col-span-2">
          <Search className="absolute right-3 top-3 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في المستخدم أو العملية أو التفاصيل..."
            className="input-dark pr-10"
          />
        </div>
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input-dark">
          {[ALL, ...BRANCHES, 'غير محدد'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="input-dark">
          {modules.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="input-dark">
          {actions.map((item) => <option key={item}>{item}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-dark" />
        <button onClick={loadLogs} className="btn-secondary">تحديث</button>
      </div>

      {loading ? (
        <div className="stat-card py-16 text-center text-slate-400">جاري تحميل السجل...</div>
      ) : filtered.length === 0 ? (
        <div className="stat-card py-20 text-center text-slate-400">
          <Activity className="mx-auto mb-4 h-10 w-10 text-slate-600" />
          لا توجد سجلات نشاط محفوظة في المصدر الحالي
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((log) => {
            const operation = safeString(log.operation || log.action, 'عملية');
            const moduleName = safeString(log.module || log.entity_type, 'النظام');
            const details = formatActivityDetails(log.details);
            return (
              <button
                type="button"
                key={log.id}
                onClick={() => setSelectedLog(log)}
                className="w-full rounded-2xl border border-slate-700/60 bg-[#101d33] p-4 text-right transition hover:border-teal-500/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={moduleBadge(moduleName)}>{moduleName}</span>
                    <span className="text-sm font-black text-white">{operation}</span>
                  </div>
                  <span className="text-xs text-slate-400">{formatDateTime(log.created_at)}</span>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
                  <span>المستخدم: {safeString(log.user_name || log.user_id, '-')}</span>
                  <span>الدور: {safeString(log.user_role, '-')}</span>
                  <span>الفرع: {logBranch(log)}</span>
                </div>
                {details && <p className="mt-3 line-clamp-2 text-sm text-slate-300">{details}</p>}
              </button>
            );
          })}
        </div>
      )}

      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSelectedLog(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-3xl border border-slate-700 bg-[#101d33] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black text-white">تفاصيل النشاط</h2>
              <button onClick={() => setSelectedLog(null)} className="btn-secondary"><X className="h-4 w-4" /></button>
            </div>
            <pre className="whitespace-pre-wrap rounded-2xl bg-slate-950/60 p-4 text-xs leading-6 text-slate-200">
              {JSON.stringify(selectedLog, null, 2)}
            </pre>
            {selectedLog.route_path && (
              <button onClick={() => navigate(selectedLog.route_path || '/')} className="btn-primary mt-4 flex items-center gap-2">
                فتح الصفحة المرتبطة <ExternalLink className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'white' | 'teal' | 'blue' | 'purple' }) {
  const color = tone === 'teal' ? 'text-teal-300' : tone === 'blue' ? 'text-blue-300' : tone === 'purple' ? 'text-purple-300' : 'text-white';
  return (
    <div className="stat-card">
      <div className={`text-2xl font-black ${color}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}
