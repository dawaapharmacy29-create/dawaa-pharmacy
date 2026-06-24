import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { Activity, Database, Search, ExternalLink, X } from 'lucide-react';
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

function logBranch(log: ActivityLogEntry) {
  return log.branch_name || log.branch || 'غير محدد';
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
  const unavailableSourcesRef = useRef(new Set<string>());

  const loadLogs = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLogs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setSourceIssue(null);
    let table: 'activity_log' | 'activity_logs' = 'activity_log';

    // activity_log is the canonical table used by every new write. Only fall
    // back to the legacy plural table when the canonical table is unavailable,
    // not merely when it is empty (an empty current log is still authoritative).
    const primary = unavailableSourcesRef.current.has('activity_log')
      ? { data: null, error: { message: 'source previously unavailable' } }
      : await supabase
          .from('activity_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(500);
    if (!primary.error) {
      setLogs((primary.data || []) as ActivityLogEntry[]);
      table = 'activity_log';
    } else {
      if (isPermissionDenied(primary.error.message) || isMissingSource(primary.error.message)) {
        unavailableSourcesRef.current.add('activity_log');
      }
      const secondary = unavailableSourcesRef.current.has('activity_logs')
        ? { data: null, error: { message: 'source previously unavailable' } }
        : await supabase
            .from('activity_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500);
      if (!secondary.error) {
        setLogs((secondary.data || []) as ActivityLogEntry[]);
        table = 'activity_logs';
      } else {
        if (isPermissionDenied(secondary.error.message) || isMissingSource(secondary.error.message)) {
          unavailableSourcesRef.current.add('activity_logs');
        }
        setLogs([]);
        if (isPermissionDenied(primary.error.message) || isPermissionDenied(secondary.error.message)) {
          setSourceIssue(
            'لا توجد صلاحية قراءة سجل الأنشطة. راجع صلاحيات RLS أو سياسة القراءة.'
          );
        } else if (isMissingSource(primary.error.message) && isMissingSource(secondary.error.message)) {
          setSourceIssue('مصدر سجل الأنشطة غير موجود: activity_log أو activity_logs.');
        } else {
          setSourceIssue(
            `تعذر قراءة activity_log و activity_logs: ${primary.error.message} / ${secondary.error.message}`
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
    () => [ALL, ...new Set(logs.map((log) => log.user_name).filter(Boolean) as string[])],
    [logs]
  );
  const actions = useMemo(
    () => [
      ALL,
      ...new Set(logs.map((log) => log.operation || log.action).filter(Boolean) as string[]),
    ],
    [logs]
  );
  const modules = useMemo(
    () => [
      ALL,
      ...new Set(logs.map((log) => log.module || log.entity_type).filter(Boolean) as string[]),
    ],
    [logs]
  );

  const filtered = useMemo(() => {
    const query = normalizeSearch(search);
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : 0;

    return logs.filter((log) => {
      const details = formatActivityDetails(log.details);
      const operation = log.operation || log.action || '';
      const module = log.module || log.entity_type || '';
      const matchSearch =
        !query ||
        matchesOrderedSegments(String(log.user_name || ''), query) ||
        matchesOrderedSegments(String(log.user_role || ''), query) ||
        matchesOrderedSegments(operation, query) ||
        matchesOrderedSegments(module, query) ||
        matchesOrderedSegments(String(log.target_type || ''), query) ||
        matchesOrderedSegments(String(log.target_id || ''), query) ||
        matchesOrderedSegments(String(log.entity_type || ''), query) ||
        matchesOrderedSegments(String(log.entity_id || ''), query) ||
        matchesOrderedSegments(details, query);
      const matchBranch = branchFilter === ALL || logBranch(log) === branchFilter;
      const matchModule = moduleFilter === ALL || module === moduleFilter;
      const matchUser = userFilter === ALL || log.user_name === userFilter;
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

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="h-16 animate-pulse bg-white/5 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="stat-card border border-teal-500/15 flex gap-3 items-start">
        <Database className="text-teal-400 flex-shrink-0 mt-1" size={20} />
        <div className="text-sm text-slate-300 leading-relaxed">
          هذا السجل يعرض العمليات المهمة داخل النظام: النقاط، التقييمات، المتابعات، الفواتير،
          والإجراءات الإدارية. مصدر البيانات الحالي:{' '}
          <span className="text-teal-300 font-mono">{sourceTable}</span>.
        </div>
      </div>

      {sourceIssue && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm font-bold leading-7 text-amber-100">
          {sourceIssue}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'إجمالي السجلات', value: logs.length, color: 'text-white' },
          {
            label: 'اليوم',
            value: logs.filter((log) => new Date(log.created_at).toDateString() === today).length,
            color: 'text-teal-400',
          },
          {
            label: 'هذا الأسبوع',
            value: logs.filter(
              (log) => Date.now() - new Date(log.created_at).getTime() < 7 * 86400000
            ).length,
            color: 'text-blue-400',
          },
          {
            label: 'مستخدمون',
            value: new Set(logs.map((log) => log.user_id || log.user_name).filter(Boolean)).size,
            color: 'text-purple-400',
          },
        ].map((stat) => (
          <div key={stat.label} className="stat-card text-center">
            <div className={`text-2xl font-bold ${stat.color} num`}>{stat.value}</div>
            <div className="text-slate-400 text-sm mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث في المستخدم أو العملية أو التفاصيل..."
            className="input-dark pl-10 w-full"
          />
        </div>
        <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-2">
          <select
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
            className="input-dark"
          >
            <option value={ALL}>كل الفروع</option>
            {BRANCHES.map((branch) => (
              <option key={branch}>{branch}</option>
            ))}
          </select>
          <select
            value={moduleFilter}
            onChange={(event) => setModuleFilter(event.target.value)}
            className="input-dark"
          >
            {modules.map((moduleName) => (
              <option key={moduleName}>{moduleName}</option>
            ))}
          </select>
          <select
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
            className="input-dark"
          >
            {users.map((userName) => (
              <option key={userName}>{userName}</option>
            ))}
          </select>
          <select
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
            className="input-dark"
          >
            {actions.map((action) => (
              <option key={action}>{action}</option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="input-dark"
          />
          <button onClick={loadLogs} className="btn-secondary">
            تحديث
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Activity size={40} className="mx-auto mb-3 opacity-20" />
            <div className="font-bold text-slate-200">
              {logs.length === 0 ? 'لا توجد سجلات نشاط محفوظة في المصدر الحالي' : 'لا توجد سجلات مطابقة'}
            </div>
            <div className="mx-auto mt-2 max-w-xl text-xs leading-6 text-slate-400">
              {logs.length === 0
                ? 'إذا كان من المتوقع ظهور عمليات هنا، راجع وجود جدول activity_log أو صلاحيات القراءة/RLS أو أن عمليات النظام تسجل فعليًا في activity_log.'
                : 'جرّب توسيع الفترة الزمنية أو إزالة بعض الفلاتر.'}
            </div>
          </div>
        ) : (
          filtered.map((log) => {
            const action = log.operation || log.action || 'عملية';
            const moduleName = log.module || log.entity_type || 'النظام';
            return (
              <div
                key={log.id}
                className="bg-[#1B2B4B] border border-[#2d4063] rounded-xl p-4 hover:border-teal-500/20 transition-all cursor-pointer"
                onClick={() => setSelectedLog(log)}
              >
                <div className="flex flex-col md:flex-row md:items-center gap-2 mb-2">
                  <span className="text-white font-bold text-sm">{action}</span>
                  <span className={moduleBadge(moduleName)}>{moduleName}</span>
                  <span className="text-slate-400 text-xs md:mr-auto">{logBranch(log)}</span>
                  <span className="text-slate-500 text-xs">{formatDateTime(log.created_at)}</span>
                </div>
                <div className="text-slate-300 text-sm leading-relaxed">
                  {log.entity_title ||
                    formatActivityDetails(
                      log.details || {
                        target_type: log.target_type,
                        target_id: log.target_id,
                        branch: logBranch(log),
                      }
                    )}
                </div>
                <div className="text-slate-500 text-xs mt-2 flex flex-wrap gap-2 items-center">
                  <span>{log.user_name || 'النظام'}</span>
                  {log.user_role && <span>• {log.user_role}</span>}
                  {(log.target_type || log.entity_type) && (
                    <span>
                      • الهدف: {log.target_type || log.entity_type}
                      {log.target_id || log.entity_id ? ` #${log.target_id || log.entity_id}` : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-[#2d4063] flex justify-between items-start">
              <div>
                <h3 className="text-white text-xl font-bold mb-2">تفاصيل السجل</h3>
                <p className="text-slate-400 text-sm">
                  {selectedLog.operation || selectedLog.action || 'عملية'}
                </p>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-400 text-xs block mb-1">المستخدم</label>
                  <div className="text-white">{selectedLog.user_name || 'النظام'}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">الدور</label>
                  <div className="text-white">{selectedLog.user_role || '-'}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">الفرع</label>
                  <div className="text-white">{logBranch(selectedLog)}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">التاريخ</label>
                  <div className="text-white">{formatDateTime(selectedLog.created_at)}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">نوع الكيان</label>
                  <div className="text-white">
                    {selectedLog.entity_type || selectedLog.target_type || '-'}
                  </div>
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">معرف الكيان</label>
                  <div className="text-white font-mono">
                    {selectedLog.entity_id || selectedLog.target_id || '-'}
                  </div>
                </div>
              </div>

              {selectedLog.entity_title && (
                <div>
                  <label className="text-slate-400 text-xs block mb-1">عنوان الكيان</label>
                  <div className="text-white">{selectedLog.entity_title}</div>
                </div>
              )}

              {selectedLog.details && (
                <div>
                  <label className="text-slate-400 text-xs block mb-1">التفاصيل</label>
                  <div className="text-white bg-[#0d1b2a] p-3 rounded-lg text-sm">
                    {formatActivityDetails(selectedLog.details)}
                  </div>
                </div>
              )}

              {selectedLog.old_value && Object.keys(selectedLog.old_value).length > 0 && (
                <div>
                  <label className="text-slate-400 text-xs block mb-1">القيمة القديمة</label>
                  <div className="text-white bg-[#0d1b2a] p-3 rounded-lg text-sm font-mono overflow-x-auto">
                    <pre>{JSON.stringify(selectedLog.old_value, null, 2)}</pre>
                  </div>
                </div>
              )}

              {selectedLog.new_value && Object.keys(selectedLog.new_value).length > 0 && (
                <div>
                  <label className="text-slate-400 text-xs block mb-1">القيمة الجديدة</label>
                  <div className="text-white bg-[#0d1b2a] p-3 rounded-lg text-sm font-mono overflow-x-auto">
                    <pre>{JSON.stringify(selectedLog.new_value, null, 2)}</pre>
                  </div>
                </div>
              )}

              {selectedLog.route_path && (
                <div className="pt-4 border-t border-[#2d4063]">
                  <label className="text-slate-400 text-xs block mb-2">الصفحة المرتبطة</label>
                  <button
                    onClick={() => {
                      navigate(selectedLog.route_path || '/');
                      setSelectedLog(null);
                    }}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <ExternalLink size={16} />
                    فتح الصفحة المرتبطة
                  </button>
                </div>
              )}

              {selectedLog.entity_type && selectedLog.entity_id && (
                <div className="pt-4 border-t border-[#2d4063]">
                  <label className="text-slate-400 text-xs block mb-2">الانتقال للكيان</label>
                  <button
                    onClick={() => {
                      const routeMap: Record<string, string> = {
                        stagnant_medicine: '/stagnant-medicines',
                        incentive_medicine: '/incentive-medicines',
                        staff_account: '/staff-accounts',
                        point_record: '/points',
                        conversation_review: '/reviews',
                        delivery_evaluation: '/delivery',
                        sales_invoice: '/invoices',
                      };
                      const basePath = routeMap[selectedLog.entity_type] || '/';
                      const fullPath = `${basePath}?id=${selectedLog.entity_id}`;
                      navigate(fullPath);
                      setSelectedLog(null);
                    }}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <ExternalLink size={16} />
                    فتح {selectedLog.entity_type}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
