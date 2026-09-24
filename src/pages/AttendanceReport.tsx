import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, ClipboardCheck, Filter, Fingerprint, LayoutDashboard, LocateFixed, LogIn, LogOut, MapPin, RefreshCw, Search, ShieldAlert, Timer, UserCheck, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import { createNotification } from '@/lib/notificationService';
import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches } from '@/lib/security/permissionScopes';
import { canManageBiometricOperations } from '@/lib/core/permissionSystem';
import { listPendingOvertime } from '@/lib/attendance/attendanceBreakdownService';
import { listStaffTimeOffRequests } from '@/lib/timeOffService';
import { lazy, Suspense } from 'react';
const AttendanceSyncCommandCenter = lazy(() => import('@/components/attendance/AttendanceSyncCommandCenter'));
const AttendanceResolutionCenter = lazy(() => import('@/components/attendance/AttendanceResolutionCenter'));
const EmployeeAttendanceBreakdown = lazy(() => import('@/components/attendance/EmployeeAttendanceBreakdown'));
const SmartDailyCommandTable = lazy(() => import('@/components/attendance/SmartDailyCommandTable'));
const BranchRoleRatesPanel = lazy(() => import('@/components/attendance/BranchRoleRatesPanel'));
const TimeOffPanel = lazy(() => import('@/pages/TimeOff'));
const OvertimeApprovalCenter = lazy(() => import('@/components/attendance/OvertimeApprovalCenter'));
const AttendancePayrollTruthPanel = lazy(() => import('@/components/attendance/AttendancePayrollTruthPanel'));
const AttendanceScheduleHealthPanel = lazy(() => import('@/components/attendance/AttendanceScheduleHealthPanel'));
const CrossBranchPunchesPanel = lazy(() => import('@/components/attendance/CrossBranchPunchesPanel'));
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  fetchAttendanceLocations,
  getDevicePosition,
  getRecentAttendanceLogs,
  saveAttendanceAttempt,
  validateAttendancePosition,
  verifyWithAvailableBiometric,
  type AttendanceLocation,
  type AttendanceType,
  type DevicePosition,
} from '@/lib/attendanceGeoService';

type Tab = 'dashboard' | 'daily' | 'decisions' | 'report' | 'system' | 'clock';
type DecisionSubTab = 'resolution' | 'overtime' | 'timeoff';
type SystemSubTab = 'sync' | 'unmapped' | 'cross-branch' | 'schedules';
type ReportSubTab = 'overview' | 'payroll-truth';
type ClockSubView = 'clock' | 'logs';

type DailyCommandRow = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  work_date: string;
  schedule_status: string;
  shift_start: string | null;
  shift_end: string | null;
  first_check_in: string | null;
  last_check_out: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  attendance_status: string;
  approved_exception_type: string | null;
  approved_exception_reason: string | null;
  biometric_events: number;
  source_status: string;
};

type SyncHealth = {
  range_start?: string | null;
  range_end?: string | null;
  raw_events?: number;
  mapped_events?: number;
  unmapped_events?: number;
  unmapped_codes?: number;
  historical_raw_events?: number;
  historical_mapped_events?: number;
  historical_unmapped_events?: number;
  last_ingested_at?: string | null;
  last_punch_time?: string | null;
  events_last_24h?: number;
  unmapped_last_24h?: number;
  provider_count?: number;
  active_clients?: number;
  client_last_seen_at?: string | null;
  sync_lag_minutes?: number | null;
  sync_status?: 'healthy' | 'delayed' | 'stale' | 'offline' | 'never_connected' | string;
  watermark_complete_through?: string | null;
  watermark_lag_minutes?: number | null;
  mapped_ratio?: number;
  events_last_hour?: number;
  events_last_7d?: number;
  branch_breakdown?: Array<{
    branch: string;
    provider?: string | null;
    events: number;
    mapped: number;
    unmapped: number;
    mapped_ratio?: number;
    last_ingested_at: string | null;
    last_punch_time?: string | null;
    client_last_seen_at?: string | null;
    endpoint_last_request_at?: string | null;
    endpoint_last_success_at?: string | null;
    active_clients?: number;
    watermark_complete_through?: string | null;
    watermark_reported_at?: string | null;
    watermark_lag_minutes?: number | null;
    connection_status?: 'healthy' | 'delayed' | 'stale' | 'offline' | 'never_connected' | string;
    data_status?: 'current_report' | 'bridge_live_no_new_watermark' | 'watermark_stale' | 'unknown' | string;
  }>;
  checked_at?: string | null;
};

type UnmappedBiometric = {
  provider: string;
  biometric_user_id: string;
  source_name: string | null;
  source_branch: string | null;
  raw_rows: number;
  cycle_rows: number;
  first_event: string | null;
  last_event: string | null;
};

type StaffCandidate = {
  staff_account_id: string;
  staff_id: string;
  staff_name: string;
  branch: string | null;
  role: string | null;
};

type CrossSourceCandidate = {
  staff_id: string;
  staff_name: string;
  staff_branch: string | null;
  staff_active: boolean;
  source_providers: string[];
  has_conflict: boolean;
};

interface ApprovalsSummary {
  pendingResolutions: number | null;
  systemInterpretation: number | null;
  systemPairable: number | null;
  trueNoPunch: number | null;
  singlePunch: number | null;
  scheduleIssues: number | null;
  totalPending: number | null;
  pendingDeductions: number | null;
  pendingOvertime: number | null;
  pendingTimeOff: number | null;
  unmappedBiometrics: number | null;
  unmappedEvents: number | null;
  crossBranchEvents: number | null;
  crossBranchStaff: number | null;
}

function settledCount(result: PromiseSettledResult<any>): number | null {
  if (result.status !== 'fulfilled') return null;
  const value = result.value;
  if (value == null) return null;
  if (Array.isArray(value)) return value.length;
  if (value.error) return null;
  return Array.isArray(value.data) ? value.data.length : null;
}

const MANAGER_TODAY_ROLES = new Set(['admin', 'general_manager', 'executive_manager', 'branches_manager', 'branch_manager', 'shift_supervisor_morning', 'shift_supervisor_evening']);

// Backward-compatible aliases so old deep links (?tab=resolution, ?tab=sync, ...) still land
// on the right place after tabs were grouped under 'decisions'/'system'/'clock'.
const TAB_ALIASES: Record<string, { tab: Tab; decisionSub?: DecisionSubTab; systemSub?: SystemSubTab; clockSub?: ClockSubView }> = {
  dashboard: { tab: 'dashboard' },
  daily: { tab: 'daily' },
  today: { tab: 'daily' },
  decisions: { tab: 'decisions' },
  resolution: { tab: 'decisions', decisionSub: 'resolution' },
  overtime: { tab: 'decisions', decisionSub: 'overtime' },
  timeoff: { tab: 'decisions', decisionSub: 'timeoff' },
  report: { tab: 'report' },
  system: { tab: 'system' },
  sync: { tab: 'system', systemSub: 'sync' },
  unmapped: { tab: 'system', systemSub: 'unmapped' },
  crossbranch: { tab: 'system', systemSub: 'cross-branch' },
  'cross-branch': { tab: 'system', systemSub: 'cross-branch' },
  schedules: { tab: 'system', systemSub: 'schedules' },
  clock: { tab: 'clock', clockSub: 'clock' },
  logs: { tab: 'clock', clockSub: 'logs' },
};

function cairoDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function attendanceCycleBounds(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const endOfCurrentCycle = day >= 26
    ? new Date(Date.UTC(year, month, 25))
    : new Date(Date.UTC(year, month - 1, 25));
  const startOfCurrentCycle = new Date(Date.UTC(
    endOfCurrentCycle.getUTCFullYear(),
    endOfCurrentCycle.getUTCMonth() - 1,
    26
  ));
  return {
    start: startOfCurrentCycle.toISOString().slice(0, 10),
    end: endOfCurrentCycle.toISOString().slice(0, 10),
  };
}

function round(value?: number | null) {
  return value == null ? 'غير محدد' : `${Math.round(Number(value))} متر`;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'غير مسجل';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Cairo' });
}

function getDeviceId() {
  try {
    const key = 'dawaa_attendance_device_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `device-${crypto.randomUUID()}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

function TableSkeleton() {
  return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-6 shadow-sm"><Skeleton className="h-5 w-48" /><div className="mt-4 space-y-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div></div>;
}

export default function AttendanceReport() {
  const { user, checkPermission, canManage } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canAllBranches = canSeeAllBranches(user?.role);
  const normalizedUserBranch = normalizeBranchName(user?.branch || '');
  const isOperationalManager = MANAGER_TODAY_ROLES.has(user?.role || '');
  const canViewSyncHealth = canManageBiometricOperations(user?.role);
  const canViewSystem = isOperationalManager;
  const canViewTimeOff = checkPermission('view_attendance_leaves') || canManage;
  const showDashboard = isOperationalManager || canViewTimeOff || canViewSyncHealth;
  const showDecisions = isOperationalManager || canViewTimeOff;
  const requestedAlias = TAB_ALIASES[searchParams.get('tab') || ''] || null;
  const [tab, setTabState] = useState<Tab>(() => {
    const allowed: Tab[] = ['report', 'clock'];
    if (isOperationalManager) allowed.push('dashboard', 'daily');
    if (showDecisions) allowed.push('decisions');
    if (canViewSystem) allowed.push('system');
    if (requestedAlias && allowed.includes(requestedAlias.tab)) return requestedAlias.tab;
    return isOperationalManager ? 'dashboard' : 'clock';
  });
  const [decisionSubTab, setDecisionSubTab] = useState<DecisionSubTab>(() => {
    if (requestedAlias?.decisionSub) return requestedAlias.decisionSub;
    if (isOperationalManager) return 'resolution';
    return 'timeoff';
  });
  const [systemSubTabState, setSystemSubTab] = useState<SystemSubTab>(() => requestedAlias?.systemSub || (canViewSyncHealth ? 'sync' : 'cross-branch'));
  const systemSubTab: SystemSubTab = canViewSyncHealth || !['sync', 'unmapped'].includes(systemSubTabState)
    ? systemSubTabState : 'cross-branch';
  const reportSubTab: ReportSubTab = searchParams.get('section') === 'payroll-truth' ? 'payroll-truth' : 'overview';
  const [resolutionFocusDate, setResolutionFocusDate] = useState<string | null>(null);
  const [resolutionFocusTriage, setResolutionFocusTriage] = useState<'all' | 'manager' | 'system'>(() => searchParams.get('triage') === 'system' ? 'system' : 'manager');
  const [clockSubView, setClockSubView] = useState<ClockSubView>(() => requestedAlias?.clockSub || 'clock');
  const [dailyDate, setDailyDate] = useState(cairoDate());
  const [branchFilter, setBranchFilter] = useState(() => (canAllBranches ? 'الكل' : normalizedUserBranch || 'الكل'));
  const [dailyRows, setDailyRows] = useState<DailyCommandRow[]>([]);
  const [dailyIntel, setDailyIntel] = useState<any[] | null>(null);
  const [dashboardTotals, setDashboardTotals] = useState({ staff: 0, onTime: 0, late: 0, missing: 0, issues: 0 });
  const [dashboardSummaryError, setDashboardSummaryError] = useState(false);
  const [dashboardSummaryAvailable, setDashboardSummaryAvailable] = useState(false);
  const dashboardRequestId = useRef(0);
  const [syncHealth, setSyncHealth] = useState<SyncHealth | null>(null);
  const [unmappedRows, setUnmappedRows] = useState<UnmappedBiometric[]>([]);
  const [mappingTarget, setMappingTarget] = useState<UnmappedBiometric | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidates, setCandidates] = useState<StaffCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<StaffCandidate | null>(null);
  const [crossSourceCandidates, setCrossSourceCandidates] = useState<CrossSourceCandidate[] | null>(null);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [batchMappingBusy, setBatchMappingBusy] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [locations, setLocations] = useState<AttendanceLocation[]>([]);
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [loadingSync, setLoadingSync] = useState(false);
  const [clocking, setClocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalsSummary, setApprovalsSummary] = useState<ApprovalsSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // The sidebar navigates between query aliases without remounting this page.
  // Keep the visible group and nested tab in step with each navigation.
  const requestedTab = searchParams.get('tab');
  const allowedTabs: Tab[] = ['report', 'clock'];
  if (isOperationalManager) allowedTabs.push('dashboard', 'daily');
  if (showDecisions) allowedTabs.push('decisions');
  if (canViewSystem) allowedTabs.push('system');
  const activeTab = requestedAlias && allowedTabs.includes(requestedAlias.tab) ? requestedAlias.tab : tab;
  const setTab = (next: Tab, sub?: DecisionSubTab | SystemSubTab) => {
    setTabState(next);
    setSearchParams((params) => {
      const updated = new URLSearchParams(params);
      updated.set('tab', next === 'decisions' ? (sub || decisionSubTab) : next === 'system' ? (sub || systemSubTab) : next);
      if (next !== 'report') updated.delete('section');
      return updated;
    }, { replace: true });
  };
  useEffect(() => {
    const destination = TAB_ALIASES[requestedTab || ''];
    if (!destination) return;
    const allowed: Tab[] = ['report', 'clock'];
    if (isOperationalManager) allowed.push('dashboard', 'daily');
    if (showDecisions) allowed.push('decisions');
    if (canViewSystem) allowed.push('system');
    if (!allowed.includes(destination.tab)) return;
    if (destination.systemSub && !canViewSyncHealth && ['sync', 'unmapped'].includes(destination.systemSub)) {
      setSearchParams((params) => { const updated = new URLSearchParams(params); updated.set('tab', 'cross-branch'); return updated; }, { replace: true });
      return;
    }
    setTabState(destination.tab);
    if (destination.decisionSub) setDecisionSubTab(destination.decisionSub);
    if (destination.systemSub) setSystemSubTab(destination.systemSub);
    if (destination.clockSub) setClockSubView(destination.clockSub);
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [requestedTab, isOperationalManager, showDecisions, canViewSystem, canViewSyncHealth, setSearchParams]);

  const userId = user?.staffId || user?.id || null;
  const userName = user?.name || 'غير محدد';
  const userBranch = user?.branch || null;

  useEffect(() => { if (!canAllBranches) setBranchFilter(normalizedUserBranch || 'الكل'); }, [canAllBranches, normalizedUserBranch]);

  const nearest = useMemo(() => (position && locations.length ? validateAttendancePosition(position, locations) : null), [position, locations]);
  const lastCheckIn = logs.find((log) => log.attendance_type === 'check_in' && ['accepted', 'manual_review'].includes(log.status));
  const lastCheckOut = logs.find((log) => log.attendance_type === 'check_out' && ['accepted', 'manual_review'].includes(log.status));

  const loadClock = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true); setError(null);
    try {
      const [locs, pos, lastLogs] = await Promise.all([fetchAttendanceLocations(), getDevicePosition().catch(() => null), getRecentAttendanceLogs(userId, 30)]);
      setLocations(locs); setPosition(pos); setLogs(lastLogs || []);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات البصمة'); } finally { setLoading(false); }
  }, [userId]);

  const effectiveBranch = !canAllBranches && normalizedUserBranch ? normalizedUserBranch : branchFilter;

  const loadDaily = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoadingDaily(true); setError(null);
    try {
      const branchArg = effectiveBranch === 'الكل' ? null : effectiveBranch;
      const [dailyResult, intelResult] = await Promise.all([
        supabase.rpc('attendance_daily_command_v1', { p_date: dailyDate, p_branch: branchArg }),
        supabase.rpc('attendance_daily_intelligence_v2', { p_date: dailyDate, p_branch: branchArg }),
      ]);
      if (dailyResult.error) throw dailyResult.error;
      setDailyRows((dailyResult.data || []) as DailyCommandRow[]);
      if (intelResult.error) {
        console.warn('[attendance] intelligence preload failed', intelResult.error);
        setDailyIntel(null);
      } else {
        setDailyIntel((intelResult.data || []) as any[]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل مركز الحضور اليومي'); } finally { setLoadingDaily(false); }
  }, [dailyDate, effectiveBranch]);

  const loadDashboardDailySummary = useCallback(async () => {
    if (!isSupabaseConfigured || !isOperationalManager) return;
    const requestId = ++dashboardRequestId.current;
    setDashboardSummaryAvailable(false);
    setDashboardSummaryError(false);
    try {
      const { data, error: summaryError } = await supabase.rpc('attendance_dashboard_daily_summary_v1', {
        p_date: dailyDate,
        p_branch: effectiveBranch === 'الكل' ? null : effectiveBranch,
      });
      if (summaryError) throw summaryError;
      if (!data || typeof data !== 'object') throw new Error('ملخص الحضور غير متاح');
      const row = data as Record<string, unknown>;
      const fields = ['staff', 'on_time', 'late', 'missing', 'issues'];
      if (fields.some((field) => row[field] == null || !Number.isFinite(Number(row[field])))) {
        throw new Error('ملخص الحضور غير مكتمل');
      }
      if (requestId !== dashboardRequestId.current) return;
      setDashboardTotals({
        staff: Number(row.staff),
        onTime: Number(row.on_time),
        late: Number(row.late),
        missing: Number(row.missing),
        issues: Number(row.issues),
      });
      setDashboardSummaryAvailable(true);
    } catch (e) {
      if (requestId !== dashboardRequestId.current) return;
      console.warn('[attendance] dashboard daily summary failed', e);
      setDashboardSummaryError(true);
    }
  }, [dailyDate, effectiveBranch, isOperationalManager]);

  const loadSyncHealth = useCallback(async () => {
    if (!isSupabaseConfigured || !canViewSyncHealth) return;
    setLoadingSync(true); setError(null);
    try {
      const today = cairoDate();
      const cycle = attendanceCycleBounds(today);
      const [healthResult, unmappedResult] = await Promise.all([
        supabase.rpc('attendance_sync_health_v4', { p_start: cycle.start, p_end: today }),
        supabase.rpc('list_unmapped_biometric_staff_v2', { p_start: cycle.start, p_end: today, p_limit: 100 }),
      ]);
      if (healthResult.error) throw healthResult.error;
      if (unmappedResult.error) throw unmappedResult.error;
      setSyncHealth((healthResult.data || {}) as SyncHealth);
      setUnmappedRows((unmappedResult.data || []) as UnmappedBiometric[]);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل حالة مزامنة البصمة'); } finally { setLoadingSync(false); }
  }, [canViewSyncHealth]);

  const loadApprovalsSummary = useCallback(async () => {
    if (!isSupabaseConfigured || !showDashboard) return;
    setLoadingSummary(true);
    try {
      const today = cairoDate();
      const cycle = attendanceCycleBounds(today);
      const [triageResult, deductionResult, overtimeResult, timeOffResult] = await Promise.allSettled([
        isOperationalManager
          ? supabase.rpc('attendance_review_triage_v1', {
              p_start: cycle.start,
              p_end: today,
              p_branch: effectiveBranch === 'الكل' ? null : effectiveBranch,
            })
          : Promise.resolve(null),
        isOperationalManager ? supabase.rpc('attendance_deduction_pending_review_v1') : Promise.resolve(null),
        isOperationalManager ? listPendingOvertime(effectiveBranch === 'الكل' ? null : effectiveBranch) : Promise.resolve(null),
        canViewTimeOff ? listStaffTimeOffRequests({ status: 'pending', limit: 200 }) : Promise.resolve(null),
      ]);

      const triage = triageResult.status === 'fulfilled' && triageResult.value && !triageResult.value.error && triageResult.value.data
        ? (triageResult.value.data as Record<string, unknown>)
        : null;

      setApprovalsSummary({
        pendingResolutions: isOperationalManager && triage ? Number(triage.needs_manager_decision || 0) : null,
        systemInterpretation: isOperationalManager && triage ? Number(triage.system_interpretation || 0) : null,
        systemPairable: isOperationalManager && triage ? Number(triage.system_pairable || 0) : null,
        trueNoPunch: isOperationalManager && triage ? Number(triage.true_no_punch || 0) : null,
        singlePunch: isOperationalManager && triage ? Number(triage.single_punch || 0) : null,
        scheduleIssues: isOperationalManager && triage ? Number(triage.schedule_issues || 0) : null,
        totalPending: isOperationalManager && triage ? Number(triage.total_pending || 0) : null,
        pendingDeductions: isOperationalManager ? settledCount(deductionResult) : null,
        pendingOvertime: isOperationalManager ? settledCount(overtimeResult) : null,
        pendingTimeOff: canViewTimeOff ? settledCount(timeOffResult) : null,
        unmappedBiometrics: canViewSyncHealth && triage ? Number(triage.unmapped_active_codes || 0) : null,
        unmappedEvents: canViewSyncHealth && triage ? Number(triage.unmapped_events || 0) : null,
        crossBranchEvents: isOperationalManager && triage ? Number(triage.cross_branch_events || 0) : null,
        crossBranchStaff: isOperationalManager && triage ? Number(triage.cross_branch_staff || 0) : null,
      });
    } finally {
      setLoadingSummary(false);
    }
  }, [canViewSyncHealth, canViewTimeOff, effectiveBranch, isOperationalManager, showDashboard]);

  const searchMappingCandidates = useCallback(async () => {
    if (!mappingTarget) return;
    const q = candidateSearch.trim();
    if (q.length < 2) { toast.warning('اكتب حرفين على الأقل من اسم الموظف'); return; }
    setMappingBusy(true);
    try {
      const { data, error: candidateError } = await supabase.rpc('list_biometric_mapping_staff_candidates_v1', { p_search: q, p_limit: 30 });
      if (candidateError) throw candidateError;
      setCandidates((data || []) as StaffCandidate[]);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'تعذر البحث عن الموظف'); }
    finally { setMappingBusy(false); }
  }, [candidateSearch, mappingTarget]);

  useEffect(() => {
    if (!mappingTarget) { setCrossSourceCandidates(null); return; }
    let current = true;
    setCrossSourceCandidates(null);
    void supabase.rpc('biometric_cross_source_candidate_v1', {
      p_provider: mappingTarget.provider,
      p_biometric_user_id: mappingTarget.biometric_user_id,
    }).then(({ data, error: candidateError }) => {
      if (!current) return;
      if (candidateError) { console.warn('[attendance] cross-source candidates unavailable', candidateError); return; }
      setCrossSourceCandidates((data || []) as CrossSourceCandidate[]);
    });
    return () => { current = false; };
  }, [mappingTarget]);

  const assignMapping = useCallback(async () => {
    if (!mappingTarget || !selectedCandidate) return;
    setMappingBusy(true);
    try {
      const { data, error: mappingError } = await supabase.rpc('assign_biometric_staff_mapping_v3', { p_provider: mappingTarget.provider, p_biometric_user_id: mappingTarget.biometric_user_id, p_staff_id: selectedCandidate.staff_id });
      if (mappingError) throw mappingError;
      const result = (data || {}) as Record<string, unknown>;
      toast.success(`تم ربط كود ${mappingTarget.biometric_user_id} بـ ${selectedCandidate.staff_name} ومعالجة ${Number(result.attendance_events_processed || 0)} بصمة وإعادة بناء ${Number(result.attendance_days_rebuilt || 0)} يوم`);
      setMappingTarget(null); setCandidateSearch(''); setCandidates([]); setSelectedCandidate(null);
      await Promise.all([loadSyncHealth(), loadDaily(), loadApprovalsSummary()]);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'تعذر اعتماد ربط البصمة'); }
    finally { setMappingBusy(false); }
  }, [loadApprovalsSummary, loadDaily, loadSyncHealth, mappingTarget, selectedCandidate]);

  const applyConfirmedBatch = useCallback(async () => {
    if (!window.confirm('اعتماد ٢١ ربطًا مؤكّدًا بالأسماء والفرع من القائمة التي راجعها صاحب العمل؟ سيتم إعادة معالجة أيام الحضور المتأثرة. الأكواد غير المعروفة والسجلات المؤرشفة خارج هذه الدفعة.')) return;
    setBatchMappingBusy(true);
    try {
      const { data, error: batchError } = await supabase.rpc('apply_confirmed_biometric_batch_v1');
      if (batchError) throw batchError;
      const result = data as { applied?: number; already_mapped?: number } | null;
      toast.success(`تم ربط ${result?.applied ?? 0} كود مؤكد. كان ${result?.already_mapped ?? 0} مربوطًا بالفعل.`);
      await Promise.all([loadSyncHealth(), loadDaily(), loadApprovalsSummary()]);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'تعذر اعتماد دفعة الربط؛ لم يتم تطبيقها'); }
    finally { setBatchMappingBusy(false); }
  }, [loadApprovalsSummary, loadDaily, loadSyncHealth]);

  useEffect(() => { if (activeTab === 'clock') void loadClock(); }, [activeTab, loadClock]);
  useEffect(() => { if (activeTab === 'daily') void loadDaily(); }, [activeTab, loadDaily]);
  useEffect(() => { if (activeTab === 'dashboard') void loadDashboardDailySummary(); }, [activeTab, loadDashboardDailySummary]);
  useEffect(() => { if (activeTab === 'system' && systemSubTab === 'unmapped') void loadSyncHealth(); }, [activeTab, systemSubTab, loadSyncHealth]);
  useEffect(() => {
    if (activeTab !== 'system' || systemSubTab !== 'unmapped' || !canViewSyncHealth) return;
    const id = window.setInterval(() => { void loadSyncHealth(); }, 60_000); // biometric-auto-refresh
    return () => window.clearInterval(id);
  }, [activeTab, systemSubTab, canViewSyncHealth, loadSyncHealth]);
  useEffect(() => { if (activeTab === 'dashboard') void loadApprovalsSummary(); }, [activeTab, loadApprovalsSummary]);

  const branches = useMemo(() => {
    if (!canAllBranches && normalizedUserBranch) return [normalizedUserBranch];
    const set = new Set<string>(['الكل']);
    dailyRows.forEach((r) => { if (r.branch) set.add(normalizeBranchName(r.branch) || r.branch); });
    ['فرع شكري', 'فرع الشامي', 'المخزن'].forEach((b) => set.add(b));
    return Array.from(set);
  }, [canAllBranches, normalizedUserBranch, dailyRows]);

  function openDecision(sub: DecisionSubTab, triage: 'all' | 'manager' | 'system' = 'manager') {
    setResolutionFocusTriage(triage);
    setTab('decisions', sub);
    setDecisionSubTab(sub);
  }

  async function notifyManager(type: AttendanceType, finalValidation: { status: string; rejectionReason?: string | null; nearestLocation?: AttendanceLocation | null; distanceMeters?: number | null }, biometric: { verified: boolean; method: string }, pos: DevicePosition) {
    const eventName = type === 'check_in' ? 'حضور' : 'انصراف'; const nowText = new Date().toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
    const statusText = finalValidation.status === 'accepted' ? 'مقبول' : finalValidation.status === 'manual_review' ? 'مراجعة يدوية' : 'مرفوض'; const locationName = finalValidation.nearestLocation?.name || userBranch || 'غير محدد';
    const message = `${userName} سجل ${eventName} الساعة ${nowText} - ${locationName} - الحالة: ${statusText} - المسافة: ${round(finalValidation.distanceMeters)} - GPS: ${round(pos.accuracy)} - التحقق: ${biometric.verified ? 'تم' : 'لم يتم'}`;
    await createNotification({ title: `تنبيه ${eventName}: ${userName}`, message, type: 'attendance', priority: finalValidation.status === 'rejected' ? 'urgent' : 'high', branch: userBranch || finalValidation.nearestLocation?.branch_name || null, target_type: 'attendance', target_id: userId, target_route: '/attendance-report?tab=resolution', recipient_role: 'general_manager', created_by: user?.id || null, created_by_name: userName, metadata: { attendance_type: type, status: finalValidation.status, rejection_reason: finalValidation.rejectionReason || null } }).catch((notificationError) => console.warn('[attendance] manager notification skipped', notificationError));
  }

  async function handleClock(type: AttendanceType) {
    setClocking(true); setError(null);
    try {
      const [locs, pos] = await Promise.all([fetchAttendanceLocations(), getDevicePosition()]); const validation = validateAttendancePosition(pos, locs);
      const biometric = validation.status === 'accepted' ? await verifyWithAvailableBiometric() : { verified: false, method: 'not_checked', message: validation.rejectionReason || '' };
      const finalValidation = validation.status === 'accepted' && !biometric.verified ? { ...validation, status: 'manual_review' as const, rejectionReason: biometric.message } : validation;
      await saveAttendanceAttempt({ user: { id: userId, name: userName, role: user?.role, branch: userBranch }, attendanceType: type, position: pos, validation: finalValidation, biometric: { verified: biometric.verified, method: biometric.method }, deviceId: getDeviceId() });
      await notifyManager(type, finalValidation, biometric, pos);
      toast[finalValidation.status === 'accepted' ? 'success' : finalValidation.status === 'manual_review' ? 'warning' : 'error'](finalValidation.status === 'accepted' ? (type === 'check_in' ? 'تم تسجيل الحضور وإرسال إشعار فوري للإدارة' : 'تم تسجيل الانصراف وإرسال إشعار فوري للإدارة') : finalValidation.rejectionReason || 'تم تسجيل المحاولة للمراجعة وإرسال إشعار للإدارة');
      await loadClock();
      if (activeTab === 'daily') await loadDaily();
      if (activeTab === 'dashboard') await loadDashboardDailySummary();
    } catch (e) { const message = e instanceof Error ? e.message : 'تعذر تسجيل الحضور'; setError(message); toast.error(message); } finally { setClocking(false); }
  }

  const decisionsBadge = (approvalsSummary?.pendingResolutions || 0) + (approvalsSummary?.pendingDeductions || 0) + (approvalsSummary?.pendingOvertime || 0) + (approvalsSummary?.pendingTimeOff || 0);

  return (
    <div className="dawaa-text dawaa-print-surface space-y-6 print:space-y-4" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm print:hidden"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h1 className="text-2xl font-black text-[var(--dawaa-theme-heading)]">الحضور والوقت</h1><p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">إدارة الحضور الفعلي والجداول والاستثناءات والبصمة من مكان واحد. الحالات السليمة تمر تلقائيًا، وما يحتاج تدخلك فقط يظهر في صندوق المراجعة.</p></div><Tabs value={activeTab} onValueChange={(v) => setTab(v as Tab)} dir="rtl"><TabsList className="h-auto flex-wrap justify-start gap-1.5 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-1.5">{isOperationalManager && <TabsTrigger value="dashboard" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><LayoutDashboard size={16} /> نظرة عامة</TabsTrigger>}{isOperationalManager && <TabsTrigger value="daily" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><Users size={16} /> متابعة اليوم</TabsTrigger>}{showDecisions && <TabsTrigger value="decisions" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><ClipboardCheck size={16} /> صندوق المراجعة <TabBadge value={decisionsBadge} /></TabsTrigger>}<TabsTrigger value="report" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><Filter size={16} /> سجل الحضور</TabsTrigger>{canViewSystem && <TabsTrigger value="system" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><Fingerprint size={16} /> إدارة البصمة <TabBadge value={approvalsSummary?.unmappedBiometrics} /></TabsTrigger>}<TabsTrigger value="clock" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><Clock size={16} /> حضوري</TabsTrigger></TabsList></Tabs></div></div>
      {error && <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-4 text-sm font-bold text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}

      {activeTab === 'dashboard' && <>
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1 text-xs font-black text-[var(--dawaa-theme-muted)]"><span>اليوم</span><input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="input-dark w-full" /></label>
          <label className="flex-1 space-y-1 text-xs font-black text-[var(--dawaa-theme-muted)]"><span>الفرع</span><select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input-dark w-full">{branches.map((b) => <option key={b}>{b}</option>)}</select></label>
          <button onClick={() => { void loadDashboardDailySummary(); void loadApprovalsSummary(); }} className="btn-primary"><RefreshCw size={16} className={loadingSummary ? 'animate-spin' : ''} /> تحديث</button>
        </div>
        {dashboardSummaryError && <div role="alert" className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-sm font-bold text-[var(--dawaa-status-danger-text)]">تعذر تحميل ملخص الحضور؛ الأعداد غير متاحة حاليًا. اضغط تحديث للمحاولة مرة أخرى.</div>}
        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="موجودين الآن" value={dashboardSummaryAvailable ? dashboardTotals.onTime : null} icon={CheckCircle2} color="text-[var(--dawaa-status-success-text)] bg-[var(--dawaa-status-success-bg)] border-[var(--dawaa-status-success-border)]" />
          <Metric label="متأخرين" value={dashboardSummaryAvailable ? dashboardTotals.late : null} icon={Clock} color="text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]" />
          <Metric label="غياب/بصمة ناقصة" value={dashboardSummaryAvailable ? dashboardTotals.missing : null} icon={XCircle} color="text-[var(--dawaa-status-danger-text)] bg-[var(--dawaa-status-danger-bg)] border-[var(--dawaa-status-danger-border)]" />
          <Metric label="مشاكل جدول" value={dashboardSummaryAvailable ? dashboardTotals.issues : null} icon={AlertTriangle} color="text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]" />
        </div>
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-base font-black text-[var(--dawaa-theme-heading)]"><ClipboardCheck size={18} className="text-[var(--dawaa-theme-primary-strong)]" /> مطلوب مراجعتك الآن</h2></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {isOperationalManager && <DecisionTile label="يحتاج قرارك فعلًا" hint={`${approvalsSummary?.trueNoPunch || 0} بدون بصمة · ${approvalsSummary?.singlePunch || 0} بصمة واحدة · ${approvalsSummary?.scheduleIssues || 0} مشكلة جدول`} value={approvalsSummary?.pendingResolutions ?? null} icon={ShieldAlert} onClick={() => openDecision('resolution', 'manager')} />}
            {isOperationalManager && <DecisionTile label="مشكلة تفسير نظام" hint={`${(approvalsSummary?.systemPairable || 0) + (approvalsSummary?.systemInterpretation || 0)} حالة عندها أكثر من بصمة — لا تعتبر خطأ موظف`} value={(approvalsSummary?.systemPairable || 0) + (approvalsSummary?.systemInterpretation || 0)} icon={AlertTriangle} onClick={() => openDecision('resolution', 'system')} />}
            {canViewSyncHealth && <DecisionTile label="أكواد نشطة غير مربوطة" hint={`${approvalsSummary?.unmappedEvents ?? 'غير متاح'} بصمة متأثرة في الدورة الحالية`} value={approvalsSummary?.unmappedBiometrics ?? null} icon={Fingerprint} onClick={() => { setSystemSubTab('unmapped'); setTab('system', 'unmapped'); }} />}
            {isOperationalManager && <DecisionTile label="بصمات من فرع آخر" hint={`${approvalsSummary?.crossBranchStaff ?? 'غير متاح'} موظفين — معلومة رقابية وليست خطأ`} value={approvalsSummary?.crossBranchEvents ?? null} icon={MapPin} onClick={() => { setSystemSubTab('cross-branch'); setTab('system', 'cross-branch'); }} />}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {isOperationalManager && <DecisionTile label="خصومات حضور بانتظار اعتمادك" hint="لا تؤثر على رصيد أي موظف قبل قرارك" value={approvalsSummary?.pendingDeductions ?? null} icon={AlertTriangle} onClick={() => openDecision('resolution', 'manager')} />}
            {isOperationalManager && <DecisionTile label="أوفر تايم بانتظار اعتمادك" hint="ساعات إضافية مسجلة تحتاج قرارك" value={approvalsSummary?.pendingOvertime ?? null} icon={Timer} onClick={() => openDecision('overtime')} />}
            {canViewTimeOff && <DecisionTile label="أذونات وإجازات معلّقة" hint="طلبات إذن/إجازة بانتظار قرارك" value={approvalsSummary?.pendingTimeOff ?? null} icon={CalendarClock} onClick={() => openDecision('timeoff')} />}
          </div>
        </div>
      </>}

      {activeTab === 'daily' && <>
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm sm:flex-row sm:items-end"><label className="flex-1 space-y-1 text-xs font-black text-[var(--dawaa-theme-muted)]"><span>اليوم</span><input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="input-dark w-full" /></label><label className="flex-1 space-y-1 text-xs font-black text-[var(--dawaa-theme-muted)]"><span>الفرع</span><select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input-dark w-full">{branches.map((b) => <option key={b}>{b}</option>)}</select></label><button onClick={() => void loadDaily()} className="btn-primary"><RefreshCw size={16} className={loadingDaily ? 'animate-spin' : ''} /> تحديث</button></div>
        {loadingDaily ? <TableSkeleton /> : dailyRows.length ? <Suspense fallback={<TableSkeleton />}><SmartDailyCommandTable rows={dailyRows} date={dailyDate} branch={effectiveBranch} preloadedIntel={dailyIntel} /></Suspense> : <Empty text="لا توجد بيانات جدول أو بصمة لهذا اليوم في النطاق الحالي." />}
      </>}

      {activeTab === 'decisions' && <>
        <Tabs value={decisionSubTab} onValueChange={(v) => { setDecisionSubTab(v as DecisionSubTab); setSearchParams((params) => { const updated = new URLSearchParams(params); updated.set('tab', v); return updated; }, { replace: true }); }} dir="rtl"><TabsList className="h-auto flex-wrap justify-start gap-1.5 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-1.5">
          {isOperationalManager && <TabsTrigger value="resolution" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><ShieldAlert size={16} /> المراجعات والتسويات <TabBadge value={(approvalsSummary?.pendingResolutions || 0) + (approvalsSummary?.pendingDeductions || 0)} /></TabsTrigger>}
          {isOperationalManager && <TabsTrigger value="overtime" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><Timer size={16} /> الأوفر تايم <TabBadge value={approvalsSummary?.pendingOvertime} /></TabsTrigger>}
          {canViewTimeOff && <TabsTrigger value="timeoff" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><CalendarClock size={16} /> الأذونات والإجازات <TabBadge value={approvalsSummary?.pendingTimeOff} /></TabsTrigger>}
        </TabsList></Tabs>
        {decisionSubTab === 'resolution' && isOperationalManager && <Suspense fallback={<TableSkeleton />}><AttendanceResolutionCenter defaultBranch={effectiveBranch} initialDate={resolutionFocusDate} initialTriage={resolutionFocusTriage} /></Suspense>}
        {decisionSubTab === 'overtime' && isOperationalManager && <Suspense fallback={<TableSkeleton />}><OvertimeApprovalCenter defaultBranch={effectiveBranch === 'الكل' ? '' : effectiveBranch} /></Suspense>}
        {decisionSubTab === 'timeoff' && canViewTimeOff && <Suspense fallback={<TableSkeleton />}><TimeOffPanel /></Suspense>}
      </>}

      {activeTab === 'report' && (
        <>
          <Tabs value={reportSubTab} onValueChange={(v) => { setSearchParams((params) => { const updated = new URLSearchParams(params); if (v === 'payroll-truth') updated.set('section', v); else updated.delete('section'); return updated; }, { replace: true }); }} dir="rtl">
            <TabsList className="h-auto flex-wrap justify-start gap-1.5 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-1.5">
              <TabsTrigger value="overview" className="rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white">سجل وتحليل الدورة</TabsTrigger>
              <TabsTrigger value="payroll-truth" className="rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white">جاهزية الحضور للمرتب</TabsTrigger>
            </TabsList>
          </Tabs>
          {reportSubTab === 'overview' && <>
            <Suspense fallback={<div className="h-24 animate-pulse rounded-2xl bg-[var(--dawaa-theme-surface-2)]" />}><BranchRoleRatesPanel /></Suspense>
            <Suspense fallback={<TableSkeleton />}>
              <EmployeeAttendanceBreakdown
                branches={branches.filter((b) => b !== 'الكل')}
                defaultBranch={effectiveBranch === 'الكل' ? (branches.find((b) => b !== 'الكل') || effectiveBranch) : effectiveBranch}
                canAllBranches={canAllBranches}
              />
            </Suspense>
          </>}
          {reportSubTab === 'payroll-truth' && <Suspense fallback={<TableSkeleton />}>
            <AttendancePayrollTruthPanel
              branches={branches}
              defaultBranch={effectiveBranch}
              onOpenResolutions={(date) => {
                setResolutionFocusDate(date);
                setResolutionFocusTriage('manager');
                setTab('decisions', 'resolution');
                setDecisionSubTab('resolution');
              }}
            />
          </Suspense>}
        </>
      )}

      {activeTab === 'system' && <>
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 text-sm leading-7 text-[var(--dawaa-theme-muted)]">
          {systemSubTab === 'sync' && <p><b className="text-[var(--dawaa-theme-heading)]">صحة أجهزة البصمة:</b> تعرض آخر اتصال وآخر بصمة وصلت من كل فرع، وتأخر المزامنة ونسبة البصمات المرتبطة. وصول بصمات حديثة يعني أن الاتصال يعمل؛ راجع الأكواد غير المربوطة قبل الاعتماد على الحضور في المرتبات.</p>}
          {systemSubTab === 'unmapped' && <p><b className="text-[var(--dawaa-theme-heading)]">أكواد تحتاج ربط:</b> كل صف هو كود على جهاز البصمة لم يُعرف الموظف المقابل له. عدد البصمات هو مرات ظهوره، وليس عدد الموظفين. افتح «اختيار الموظف» للكود المؤكد فقط؛ اترك أي كود غير معروف للمراجعة.</p>}
          {systemSubTab === 'cross-branch' && <p><b className="text-[var(--dawaa-theme-heading)]">العمل بين الفروع:</b> يعرض موظفًا مسجلاً في فرع وبصم في فرع آخر. راجع مكان عمله في اليوم المعروض؛ الظهور هنا لا يعني مخالفة تلقائيًا.</p>}
          {systemSubTab === 'schedules' && <p><b className="text-[var(--dawaa-theme-heading)]">جودة الجداول:</b> تعرض الأيام التي يصعب فيها تفسير البصمات بسبب جدول ناقص أو متعارض. صحح الجدول أولًا ثم راجع الحضور الناتج عنه.</p>}
        </div>
        <Tabs value={systemSubTab} onValueChange={(v) => { setSystemSubTab(v as SystemSubTab); setSearchParams((params) => { const updated = new URLSearchParams(params); updated.set('tab', v); return updated; }, { replace: true }); }} dir="rtl"><TabsList className="h-auto flex-wrap justify-start gap-1.5 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-1.5">
          {canViewSyncHealth && <TabsTrigger value="sync" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><Fingerprint size={16} /> صحة الأجهزة والمزامنة</TabsTrigger>}
          {canViewSyncHealth && <TabsTrigger value="unmapped" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><UserCheck size={16} /> أكواد تحتاج ربط <TabBadge value={approvalsSummary?.unmappedBiometrics} /></TabsTrigger>}<TabsTrigger value="cross-branch" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><MapPin size={16} /> العمل بين الفروع <TabBadge value={approvalsSummary?.crossBranchStaff} /></TabsTrigger><TabsTrigger value="schedules" className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md"><CalendarClock size={16} /> جودة الجداول</TabsTrigger>
        </TabsList></Tabs>
        {systemSubTab === 'sync' && <Suspense fallback={<TableSkeleton />}><AttendanceSyncCommandCenter branches={branches} defaultBranch={effectiveBranch} /></Suspense>}
        {systemSubTab === 'unmapped' && <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm"><div><h2 className="font-black text-[var(--dawaa-theme-heading)]">صحة مزامنة جهاز البصمة وربط الأكواد</h2><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">مراقبة مباشرة للاتصال والمزامنة، وربط أكواد البصمة غير المرتبطة بموظف. يتم التحديث تلقائيًا كل دقيقة.</p></div><div className="flex flex-wrap gap-2"><button disabled={batchMappingBusy || loadingSync} onClick={() => void applyConfirmedBatch()} className="btn-secondary">{batchMappingBusy ? 'جارٍ ربط الأكواد...' : 'اعتماد ٢١ كود مؤكّد'}</button><button onClick={() => void loadSyncHealth()} className="btn-primary"><RefreshCw size={16} className={loadingSync ? 'animate-spin' : ''} /> تحديث</button></div></div>
          {loadingSync ? <TableSkeleton /> : syncHealth ? <SyncHealthPanel health={syncHealth} /> : <Empty text="لا توجد بيانات مزامنة متاحة." />}
          {!loadingSync && <BiometricMappingQueue rows={unmappedRows} target={mappingTarget} crossSourceCandidates={crossSourceCandidates} search={candidateSearch} candidates={candidates} selected={selectedCandidate} busy={mappingBusy} onOpen={(row) => { setMappingTarget(row); setCandidateSearch(row.source_name || ''); setCandidates([]); setSelectedCandidate(null); }} onClose={() => { setMappingTarget(null); setCandidateSearch(''); setCandidates([]); setSelectedCandidate(null); }} onSearchChange={setCandidateSearch} onSearch={() => void searchMappingCandidates()} onSelect={setSelectedCandidate} onAssign={() => void assignMapping()} />}
        </>}
        {systemSubTab === 'cross-branch' && <Suspense fallback={<TableSkeleton />}>
          <CrossBranchPunchesPanel defaultBranch={effectiveBranch} />
        </Suspense>}
        {systemSubTab === 'schedules' && <Suspense fallback={<TableSkeleton />}>
          <AttendanceScheduleHealthPanel defaultBranch={effectiveBranch} />
        </Suspense>}
      </>}

      {activeTab === 'clock' && <>
        <div className="flex items-center gap-1 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-1 w-fit">
          <button onClick={() => setClockSubView('clock')} className={cn('rounded-lg px-3 py-1.5 text-xs font-black', clockSubView === 'clock' ? 'bg-[var(--dawaa-theme-primary)] text-white' : 'text-[var(--dawaa-theme-muted)]')}>تسجيل حضور</button>
          <button onClick={() => setClockSubView('logs')} className={cn('rounded-lg px-3 py-1.5 text-xs font-black', clockSubView === 'logs' ? 'bg-[var(--dawaa-theme-primary)] text-white' : 'text-[var(--dawaa-theme-muted)]')}>محاولاتي</button>
        </div>
        {clockSubView === 'clock' && <div className="grid gap-4 lg:grid-cols-3"><Panel title="بيانات الموظف" icon={Fingerprint}><Info label="الاسم" value={userName} /><Info label="الدور" value={user?.role || 'غير محدد'} /><Info label="الفرع" value={userBranch || 'غير محدد'} /></Panel><Panel title="حالة الموقع" icon={LocateFixed}>{loading ? <Skeleton className="h-24 w-full" /> : nearest ? <><Info label="أقرب موقع" value={nearest.nearestLocation?.name || 'غير محدد'} /><Info label="المسافة" value={round(nearest.distanceMeters)} /><Info label="دقة GPS" value={round(position?.accuracy)} /><div className={cn('mt-3 rounded-xl border p-3 text-sm font-black', nearest.status === 'accepted' ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]')}>{nearest.status === 'accepted' ? 'داخل النطاق ومتاح التسجيل' : nearest.rejectionReason}</div></> : <div className="text-sm font-bold text-[var(--dawaa-theme-muted)]">اضغط تحديث للحصول على الموقع قبل التسجيل.</div>}</Panel><Panel title="تسجيل سريع" icon={Clock}><Info label="آخر حضور" value={formatDateTime(lastCheckIn?.recorded_at)} /><Info label="آخر انصراف" value={formatDateTime(lastCheckOut?.recorded_at)} /><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={clocking} onClick={() => void handleClock('check_in')} className="btn-primary"><LogIn size={16} /> حضور</button><button disabled={clocking} onClick={() => void handleClock('check_out')} className="btn-secondary"><LogOut size={16} /> انصراف</button></div><button onClick={() => void loadClock()} className="btn-secondary mt-2 w-full"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث الموقع</button></Panel></div>}
        {clockSubView === 'logs' && <AttendanceLogs logs={logs} loading={loading} />}
      </>}
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) { return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm"><h2 className="mb-4 flex items-center gap-2 text-lg font-black text-[var(--dawaa-theme-heading)]"><Icon size={20} className="text-[var(--dawaa-theme-primary-strong)]" /> {title}</h2>{children}</div>; }
function Info({ label, value }: { label: string; value: React.ReactNode }) { return <div className="mb-2 flex items-center justify-between gap-3 rounded-xl dawaa-surface-soft px-3 py-2 text-sm"><span className="font-bold text-[var(--dawaa-theme-muted)]">{label}</span><b className="text-[var(--dawaa-theme-heading)]">{value}</b></div>; }
function Metric({ label, value, icon: Icon, color }: { label: string; value: number | null; icon: any; color: string }) { return <div className="dawaa-surface flex items-center gap-3 rounded-2xl border p-4 shadow-sm"><span className={cn('rounded-xl border p-2', color)}><Icon size={28} /></span><div><div className="text-xs font-bold">{label}</div><div className="text-3xl font-black">{value == null ? '—' : value.toLocaleString('ar-EG')}</div></div></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-8 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">{text}</div>; }
function TabBadge({ value }: { value?: number | null }) { if (!value) return null; return <span className="inline-flex min-w-[18px] items-center justify-center rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-danger-text)]">{value > 99 ? '99+' : value}</span>; }
function DecisionTile({ label, hint, value, icon: Icon, onClick }: { label: string; hint: string; value: number | null; icon: any; onClick: () => void }) {
  const isUnknown = value == null;
  const isClear = value === 0;
  const tone = isUnknown
    ? 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]'
    : isClear
    ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'
    : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]';
  return (
    <button onClick={onClick} className={cn('flex flex-col items-start gap-1 rounded-2xl border p-3 text-right transition hover:shadow-md', tone)}>
      <span className="flex w-full items-center justify-between gap-2"><Icon size={18} /><span className="text-2xl font-black">{value == null ? '—' : value.toLocaleString('ar-EG')}</span></span>
      <span className="text-xs font-black">{label}</span>
      <span className="text-[10px] font-bold opacity-80">{isUnknown ? 'تعذر تحميل هذا المؤشر — اضغط تحديث' : hint}</span>
    </button>
  );
}
function SyncHealthPanel({ health }: { health: SyncHealth }) {
  const raw = Number(health.raw_events || 0);
  const mapped = Number(health.mapped_events || 0);
  const unmapped = Number(health.unmapped_events || 0);
  const unmappedCodes = Number(health.unmapped_codes || 0);
  const historicalRaw = Number(health.historical_raw_events || 0);
  const historicalMapped = Number(health.historical_mapped_events || 0);
  const historicalUnmapped = Number(health.historical_unmapped_events || 0);
  const ratio = Number(health.mapped_ratio ?? (raw ? (mapped / raw) * 100 : 0));
  const lag = health.sync_lag_minutes == null ? null : Number(health.sync_lag_minutes);
  const status = health.sync_status || (lag == null ? 'never_connected' : lag <= 5 ? 'healthy' : lag <= 30 ? 'delayed' : lag <= 180 ? 'stale' : 'offline');
  const statusMap: Record<string, {label:string; cls:string}> = {
    healthy:{label:'المزامنة تعمل الآن',cls:'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'},
    delayed:{label:'تأخير بسيط في المزامنة',cls:'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]'},
    stale:{label:'المزامنة متأخرة',cls:'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]'},
    offline:{label:'المزامنة متوقفة',cls:'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]'},
    never_connected:{label:'لم يتم رصد اتصال',cls:'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]'},
  };
  const st = statusMap[status] || statusMap.offline;
  return <div className="space-y-4">
    <div className={cn('rounded-2xl border p-4 font-black', st.cls)}><div className="flex flex-wrap items-center justify-between gap-2"><span>{st.label}</span><span className="text-xs">آخر اتصال: {formatDateTime(health.client_last_seen_at || health.last_ingested_at)}</span></div><div className="mt-1 text-xs opacity-80">{lag == null ? 'لا توجد مدة تأخير محسوبة' : 'التأخير الحالي: ' + Math.round(lag) + ' دقيقة'}</div></div>
    <div className="rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
      الأرقام الرئيسية أدناه تخص الدورة الحالية فقط ({health.range_start || '-'} ← {health.range_end || '-'}). السجل التاريخي محفوظ في الأرشيف ولا يدخل ضمن المطلوب متابعته الآن.
    </div>
    <div className="grid gap-3 md:grid-cols-4"><Metric label="بصمات الدورة الحالية" value={raw} icon={Fingerprint} color="text-[var(--dawaa-status-info-text)] bg-[var(--dawaa-status-info-bg)] border-[var(--dawaa-status-info-border)]" /><Metric label="مربوطة في الدورة" value={mapped} icon={UserCheck} color="text-[var(--dawaa-status-success-text)] bg-[var(--dawaa-status-success-bg)] border-[var(--dawaa-status-success-border)]" /><Metric label="غير مربوطة في الدورة" value={unmapped} icon={AlertTriangle} color="text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]" /><Metric label="أكواد نشطة تحتاج ربط" value={unmappedCodes} icon={Users} color="text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]" /></div>
    <div className="grid gap-4 lg:grid-cols-3"><Panel title="حالة الاتصال" icon={ShieldAlert}><Info label="عملاء API النشطون" value={Number(health.active_clients || 0)} /><Info label="آخر اتصال للعميل" value={formatDateTime(health.client_last_seen_at)} /><Info label="آخر دفعة وصلت" value={formatDateTime(health.last_ingested_at)} /><Info label="آخر وقت بصمة" value={formatDateTime(health.last_punch_time)} /></Panel><Panel title="جودة الربط" icon={UserCheck}><Info label="نسبة الربط" value={ratio.toFixed(1) + '%'} /><Info label="غير مربوط آخر 24 ساعة" value={Number(health.unmapped_last_24h || 0).toLocaleString('ar-EG')} /><Info label="آخر ساعة" value={Number(health.events_last_hour || 0).toLocaleString('ar-EG')} /><Info label="آخر 7 أيام" value={Number(health.events_last_7d || 0).toLocaleString('ar-EG')} /></Panel><Panel title="استمرارية المزامنة" icon={RefreshCw}><Info label="آخر Watermark مكتمل" value={formatDateTime(health.watermark_complete_through)} /><Info label="تأخير Watermark" value={health.watermark_lag_minutes == null ? 'غير مسجل' : Math.round(Number(health.watermark_lag_minutes)) + ' دقيقة'} /><Info label="عدد المزودين" value={Number(health.provider_count || 0)} /><Info label="آخر فحص للوحة" value={formatDateTime(health.checked_at)} /></Panel></div>
    {!!health.branch_breakdown?.length && <Panel title="المزامنة حسب الفرع — الدورة الحالية" icon={Users}><div className="grid gap-2 md:grid-cols-2">{health.branch_breakdown.map((b) => {
      const connectionLabel = b.connection_status === 'healthy' ? 'متصل الآن' : b.connection_status === 'delayed' ? 'اتصال متأخر' : b.connection_status === 'stale' ? 'اتصال قديم' : b.connection_status === 'offline' ? 'غير متصل' : 'غير معروف';
      const dataLabel = b.data_status === 'bridge_live_no_new_watermark' ? 'الـBridge حي — لا Watermark جديد' : b.data_status === 'current_report' ? 'Watermark حديث' : b.data_status === 'watermark_stale' ? 'Watermark قديم' : 'Watermark غير معروف';
      return <div key={b.branch} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-black text-[var(--dawaa-theme-heading)]">{b.branch}</div>
          <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5 text-[10px] font-black text-[var(--dawaa-theme-muted)]">{connectionLabel}</span>
        </div>
        <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{Number(b.events).toLocaleString('ar-EG')} بصمة · {Number(b.mapped).toLocaleString('ar-EG')} مربوطة · {Number(b.unmapped).toLocaleString('ar-EG')} غير مربوطة</div>
        <div className="mt-1 text-[11px] text-[var(--dawaa-theme-muted)]">آخر اتصال Bridge: {formatDateTime(b.endpoint_last_success_at || b.client_last_seen_at)}</div>
        <div className="mt-1 text-[11px] text-[var(--dawaa-theme-muted)]">آخر بصمة: {formatDateTime(b.last_punch_time || b.last_ingested_at)}</div>
        <div className="mt-1 text-[11px] text-[var(--dawaa-theme-muted)]">{dataLabel}{b.watermark_lag_minutes == null ? '' : ` · تأخير Watermark ${Math.round(Number(b.watermark_lag_minutes))} د`}</div>
      </div>;
    })}</div></Panel>}
    <Panel title="الأرشيف التاريخي قبل الدورة الحالية" icon={Clock}>
      <div className="grid gap-2 sm:grid-cols-3">
        <Info label="بصمات محفوظة" value={historicalRaw.toLocaleString('ar-EG')} />
        <Info label="مربوطة تاريخيًا" value={historicalMapped.toLocaleString('ar-EG')} />
        <Info label="غير مربوطة تاريخيًا" value={historicalUnmapped.toLocaleString('ar-EG')} />
      </div>
      <div className="mt-2 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">هذه أرقام أرشيفية فقط ولا تُضاف إلى قائمة العمل الحالية. لا نحذفها إلا لو ثبت أنها دفعة تجريبية غير مستخدمة.</div>
    </Panel>
  </div>;
}
function BiometricMappingQueue({
  rows,
  target,
  crossSourceCandidates,
  search,
  candidates,
  selected,
  busy,
  onOpen,
  onClose,
  onSearchChange,
  onSearch,
  onSelect,
  onAssign,
}: {
  rows: UnmappedBiometric[];
  target: UnmappedBiometric | null;
  crossSourceCandidates: CrossSourceCandidate[] | null;
  search: string;
  candidates: StaffCandidate[];
  selected: StaffCandidate | null;
  busy: boolean;
  onOpen: (row: UnmappedBiometric) => void;
  onClose: () => void;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  onSelect: (candidate: StaffCandidate) => void;
  onAssign: () => void;
}) {
  const affectedEvents = rows.reduce((sum, row) => sum + Number(row.cycle_rows || 0), 0);
  return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h2 className="font-black text-[var(--dawaa-theme-heading)]">أكواد بصمة نشطة تحتاج ربط</h2>
        <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
          القائمة تعرض فقط الأكواد التي استخدمت فعليًا في الدورة الحالية، مرتبة حسب عدد البصمات المتأثرة. الربط لا يغيّر مكان البصمة الحقيقي.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-warning-text)]">{rows.length.toLocaleString('ar-EG')} كود نشط</span>
        <span className="rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-info-text)]">{affectedEvents.toLocaleString('ar-EG')} بصمة متأثرة</span>
      </div>
    </div>

    {!rows.length ? <div className="rounded-xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] p-4 text-sm font-black text-[var(--dawaa-status-success-text)]">كل الأكواد النشطة في الدورة الحالية مربوطة بموظفين.</div> : <div className="overflow-x-auto">
      <table className="dawaa-table-semantic min-w-[900px] w-full text-sm">
        <thead><tr className="text-right">
          <th className="p-3">الكود</th>
          <th className="p-3">فرع الجهاز</th>
          <th className="p-3">الاسم من الجهاز</th>
          <th className="p-3">بصمات الدورة</th>
          <th className="p-3">إجمالي السجل</th>
          <th className="p-3">آخر بصمة</th>
          <th className="p-3">الإجراء</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={`${row.provider}-${row.biometric_user_id}`} className="border-t border-[var(--dawaa-theme-divider)]">
          <td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{row.biometric_user_id}</td>
          <td className="p-3"><span className="inline-flex items-center gap-1 rounded-full border border-[var(--dawaa-theme-border)] px-2 py-1 text-xs font-black"><MapPin size={12}/>{row.source_branch || 'غير محدد'}</span></td>
          <td className="p-3 font-bold">{row.source_name || 'غير مسجل'}</td>
          <td className="p-3"><span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-1 font-black text-[var(--dawaa-status-warning-text)]">{Number(row.cycle_rows || 0).toLocaleString('ar-EG')}</span></td>
          <td className="p-3">{Number(row.raw_rows || 0).toLocaleString('ar-EG')}</td>
          <td className="p-3 text-xs font-bold">{formatDateTime(row.last_event)}</td>
          <td className="p-3"><button onClick={() => onOpen(row)} className="btn-secondary"><UserCheck size={15} /> اختيار الموظف</button></td>
        </tr>)}</tbody>
      </table>
    </div>}

    {target && <div className="mt-5 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">ربط كود {target.biometric_user_id} · جهاز {target.source_branch || 'غير محدد'}</div>
          <div className="text-lg font-black text-[var(--dawaa-theme-heading)]">{target.source_name || 'اسم غير معروف من الجهاز'}</div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-status-warning-text)]">{Number(target.cycle_rows || 0).toLocaleString('ar-EG')} بصمة في الدورة الحالية ستُعاد معالجتها بعد الربط.</div>
        </div>
        <button onClick={onClose} className="btn-secondary">إلغاء</button>
      </div>
      {crossSourceCandidates && crossSourceCandidates.length > 0 && <div className="mb-3 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
        <div>نفس الكود له ربط سابق في مصدر بصمة آخر. دي أسماء للمراجعة فقط، وليست ربطًا تلقائيًا؛ ممكن الرقم يتكرر لشخص مختلف على جهاز آخر.</div>
        {crossSourceCandidates.map((match) => <div key={match.staff_id} className="mt-1">{match.staff_name} · {match.staff_branch || 'بدون فرع'} · {match.staff_active ? 'نشط' : 'مؤرشف'} · {match.source_providers.join('، ')}</div>)}
        {crossSourceCandidates.some((match) => match.has_conflict) && <div className="mt-1">تنبيه: نفس الكود مربوط بأكثر من موظف؛ راجع هوية الجهاز قبل الاعتماد.</div>}
      </div>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={search} onChange={(e) => onSearchChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }} placeholder="اكتب اسم الموظف الحقيقي..." className="input-dark flex-1" />
        <button disabled={busy} onClick={onSearch} className="btn-primary"><Search size={16} /> بحث</button>
      </div>
      {!!candidates.length && <div className="mt-3 grid gap-2">{candidates.map((candidate) => <button key={candidate.staff_account_id} onClick={() => onSelect(candidate)} className={cn('rounded-xl border p-3 text-right transition', selected?.staff_account_id === candidate.staff_account_id ? 'border-[var(--dawaa-theme-primary)] bg-[var(--dawaa-status-success-bg)]' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] hover:bg-[var(--dawaa-theme-surface-2)]')}>
        <div className="font-black text-[var(--dawaa-theme-heading)]">{candidate.staff_name}</div>
        <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{candidate.branch || '-'} · {candidate.role || '-'}</div>
      </button>)}</div>}
      {selected && <div className="mt-4 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3">
        <div className="text-sm font-black text-[var(--dawaa-status-warning-text)]">
          تأكيد: الكود {target.biometric_user_id} من جهاز {target.source_branch || 'غير محدد'} سيتم ربطه بـ {selected.staff_name} ({selected.branch || '-'}).
          مكان البصمات الخام سيظل محفوظًا كما هو، ثم يعيد النظام معالجة الأيام المتأثرة تلقائيًا.
        </div>
        <button disabled={busy} onClick={onAssign} className="btn-primary mt-3 w-full">{busy ? 'جارٍ الاعتماد...' : 'اعتماد الربط وإعادة معالجة الأيام'}</button>
      </div>}
    </div>}
  </div>;
}
function attemptStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    accepted: 'مقبولة',
    rejected: 'مرفوضة',
    pending: 'قيد المراجعة',
    pending_review: 'قيد المراجعة',
    flagged: 'محتاجة مراجعة',
  };
  return labels[status || ''] || status || 'غير محدد';
}

function AttendanceLogs({ logs, loading }: { logs: any[]; loading: boolean }) { if (loading) return <TableSkeleton />; if (!logs.length) return <Empty text="لا توجد محاولات حضور بعد." />; return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="dawaa-table-semantic min-w-full text-sm"><thead><tr className="text-right"><th className="p-3">الوقت</th><th className="p-3">النوع</th><th className="p-3">الحالة</th><th className="p-3">الفرع</th><th className="p-3">المسافة</th><th className="p-3">GPS</th><th className="p-3">التحقق</th><th className="p-3">السبب</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className="border-t border-[var(--dawaa-theme-divider)]"><td className="p-3 font-bold text-[var(--dawaa-theme-heading)]">{formatDateTime(log.recorded_at)}</td><td className="p-3">{log.attendance_type === 'check_in' ? 'حضور' : 'انصراف'}</td><td className="p-3"><span className={`rounded-full border px-2 py-0.5 text-xs font-black ${log.status === 'accepted' ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : log.status === 'rejected' ? 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]' : 'border-[var(--dawaa-theme-border)]'}`}>{attemptStatusLabel(log.status)}</span></td><td className="p-3">{log.branch_name || '-'}</td><td className="p-3">{round(log.distance_from_location_meters)}</td><td className="p-3">{round(log.gps_accuracy_meters)}</td><td className="p-3">{log.biometric_verified ? 'تم' : 'مراجعة'}</td><td className="p-3 text-[var(--dawaa-theme-muted)]">{log.rejection_reason || '-'}</td></tr>)}</tbody></table></div></div>; }
