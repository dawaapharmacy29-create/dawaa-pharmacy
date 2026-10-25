import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import {
  approveAttendanceResolution,
  getAttendanceDayEvidence,
  resolveDatedAttendanceShift,
  resolveAttendancePermission,
  type AttendanceResolutionRow,
  getAttendanceCaseDiagnosticV1,
  getAttendanceDiagnosticSummaryV1,
  getMissingPunchContextV1,
  isFormerAttendanceReviewRow,
  listAttendanceExceptionInbox,
  listStaffMissingPunchHistoryV1,
  materializeAttendanceRange,
  resolveMissingPunchIncidentV1,
  type AttendanceCaseDiagnosticV1,
  type AttendanceDiagnosticSummaryV1,
  type AttendanceExceptionLane,
  type AttendanceExceptionRow,
  type MissingPunchContextV1,
  type MissingPunchHistoryRowV1,
} from '@/lib/attendance/attendanceResolutionService';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@/lib/core/permissionSystem';
import { cairoWallClockToDate } from '@/lib/time/cairoDateBoundary';
import EmployeeProfileDrawer from '@/components/attendance/EmployeeProfileDrawer';
import { cairoToday, startOfMonth } from '@/lib/attendance/period';
import AttendanceCorrectionReviewPanel from '@/components/attendance/AttendanceCorrectionReviewPanel';
import AttendanceShiftMismatchReview from '@/components/attendance/AttendanceShiftMismatchReview';
import {
  approveAttendanceFullDayTimeOffV1,
  getAnnualLeaveAttendancePreviewV1,
  listStaffTimeOffRequests,
  resolveAnnualLeaveFromAttendanceV1,
  type AnnualLeaveAttendancePreviewV1,
  type StaffTimeOffRequest,
  type TimeOffKind,
} from '@/lib/timeOffService';
import {
  getWeeklyOffSwapPreviewV1,
  resolveWeeklyOffSwapFromAttendanceV1,
  type WeeklyOffSwapPreviewV1,
} from '@/lib/hr/canonicalScheduleService';

function cairoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function fmt(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function arabicWeekday(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
  }).format(date);
}

function toCairoDateTimeLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function laneMeta(lane: AttendanceExceptionLane) {
  if (lane === 'system') {
    return {
      label: 'مشكلة نظام',
      className: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]',
      description: 'لا تُنسب للموظف ولا تعتمد كغياب أو خصم قبل إصلاح السبب النظامي.',
    };
  }
  return {
    label: 'يحتاج قرار مدير',
    className: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]',
    description: 'حالة تحتاج قرارًا بشريًا موثقًا بعد مراجعة الدليل.',
  };
}

type Decision = { id: string; label: string; requestKind?: TimeOffKind; financial?: boolean; schedule?: boolean };
const ABSENCE_DECISIONS: Decision[] = [
  { id: 'annual_leave', label: 'إجازة سنوية', requestKind: 'annual_leave' },
  { id: 'sick_leave', label: 'إجازة مرضية', requestKind: 'sick_leave' },
  { id: 'exceptional_leave', label: 'إجازة عارضة', requestKind: 'exceptional_leave' },
  { id: 'approved_absence', label: 'غياب بإذن', requestKind: 'approved_absence' },
  { id: 'shift_swap', label: 'تبديل الراحة', requestKind: 'shift_swap', schedule: true },
  { id: 'absence_deduction', label: 'غياب بخصم', financial: true },
  { id: 'outside_work', label: 'عمل خارجي' },
  { id: 'custom', label: 'سبب آخر' },
];
const PUNCH_DECISIONS: Decision[] = [
  { id: 'forgot_in', label: 'نسيان دخول' },
  { id: 'forgot_out', label: 'نسيان خروج' },
  { id: 'device_fault', label: 'عطل الجهاز' },
  { id: 'cross_branch', label: 'فرع آخر' },
  { id: 'custom', label: 'سبب آخر' },
];
const TIME_DECISIONS: Decision[] = [
  { id: 'permission', label: 'إذن معتمد', requestKind: 'permission' },
  { id: 'time_deduction', label: 'خصم وقت', financial: true },
  { id: 'shift_swap', label: 'تعديل الشيفت', requestKind: 'shift_swap', schedule: true },
  { id: 'schedule_error', label: 'تصحيح الجدول', schedule: true },
  { id: 'custom', label: 'سبب آخر' },
];

const BULK_SAFE_DECISION_IDS = new Set([
  'annual_leave',
  'sick_leave',
  'exceptional_leave',
  'approved_absence',
  'absence_deduction',
  'outside_work',
  'custom',
  'device_fault',
  'cross_branch',
  'time_deduction',
]);

function baseDecisionsFor(row: AttendanceExceptionRow): Decision[] {
  if (row.issue_group === 'absence' || row.resolution_status === 'absence_review') return ABSENCE_DECISIONS;
  if (row.resolution_status === 'missing_checkin') return PUNCH_DECISIONS.filter((item) => item.id !== 'forgot_out');
  if (row.resolution_status === 'missing_checkout') return PUNCH_DECISIONS.filter((item) => item.id !== 'forgot_in');
  if (row.issue_group === 'missing_punch' || row.resolution_status?.startsWith('missing_')) return PUNCH_DECISIONS;
  return TIME_DECISIONS;
}

function decisionsFor(row: AttendanceExceptionRow): Decision[] {
  const base = baseDecisionsFor(row);
  // The same existing actions remain available while resolving any manager case.
  return [...base, ...TIME_DECISIONS.filter((item) =>
    ['permission', 'schedule_error'].includes(item.id) && !base.some((existing) => existing.id === item.id))];
}

export default function AttendanceResolutionCenter({
  defaultBranch = 'الكل',
  initialDate = null,
  initialTriage = 'manager',
  initialStaffId = null,
  initialCurrentCycle = false,
  embedded = false,
  onDecisionSaved,
}: {
  defaultBranch?: string;
  initialDate?: string | null;
  initialTriage?: 'all' | 'manager' | 'system';
  initialStaffId?: string | null;
  initialCurrentCycle?: boolean;
  embedded?: boolean;
  onDecisionSaved?: () => void;
}) {
  const { user } = useAuth();
  const canApproveDay = hasPermission(user, 'manage_payroll');
  const [start, setStart] = useState(() => initialCurrentCycle ? startOfMonth(cairoToday()) : initialDate || cairoDate(-7));
  const [end, setEnd] = useState(() => initialCurrentCycle ? cairoToday() : initialDate || cairoDate());
  const [branch, setBranch] = useState(defaultBranch || 'الكل');
  const [staffFilter, setStaffFilter] = useState('all');
  const [lane, setLane] = useState<'all' | AttendanceExceptionLane>(initialTriage);
  const [rows, setRows] = useState<AttendanceExceptionRow[]>([]);
  const [diagnosticSummary, setDiagnosticSummary] = useState<AttendanceDiagnosticSummaryV1 | null>(null);
  const [categoryTab, setCategoryTab] = useState<'all' | 'absence' | 'early_leave' | 'missing_punch' | 'system'>('all');
  const [missingPunchTab, setMissingPunchTab] = useState<'all' | 'check_in' | 'check_out'>('all');
  const [showFormer, setShowFormer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const selectedPanelRef = useRef<HTMLDivElement | null>(null);
  const [materializing, setMaterializing] = useState(false);
  const [selected, setSelected] = useState<AttendanceExceptionRow | null>(null);
  const [profileStaffId, setProfileStaffId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [multiplier, setMultiplier] = useState('');
  const [approvedRequests, setApprovedRequests] = useState<StaffTimeOffRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState(false);
  const [annualLeavePreview, setAnnualLeavePreview] = useState<AnnualLeaveAttendancePreviewV1 | null>(null);
  const [annualLeavePreviewLoading, setAnnualLeavePreviewLoading] = useState(false);
  const [annualLeavePreviewError, setAnnualLeavePreviewError] = useState(false);
  const [weeklyOffSwapPreview, setWeeklyOffSwapPreview] = useState<WeeklyOffSwapPreviewV1 | null>(null);
  const [weeklyOffSwapLoading, setWeeklyOffSwapLoading] = useState(false);
  const [weeklyOffSwapError, setWeeklyOffSwapError] = useState(false);
  const [swapWithDate, setSwapWithDate] = useState('');
  const [diagnostic, setDiagnostic] = useState<AttendanceCaseDiagnosticV1 | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState(false);
  const [missingPunchContext, setMissingPunchContext] = useState<MissingPunchContextV1 | null>(null);
  const [missingPunchHistory, setMissingPunchHistory] = useState<MissingPunchHistoryRowV1[]>([]);
  const [missingPunchLoading, setMissingPunchLoading] = useState(false);
  const [manualPunchAt, setManualPunchAt] = useState('');
  const [applyMissingPunchPenalty, setApplyMissingPunchPenalty] = useState(false);
  const [hours, setHours] = useState('');
  const [permissionStart, setPermissionStart] = useState('');
  const [permissionEnd, setPermissionEnd] = useState('');
  const [approving, setApproving] = useState(false);
  const mutationLock = useRef(false);
  const evidenceRefreshLock = useRef(false);
  const [requiredPermissionId, setRequiredPermissionId] = useState<string | null>(null);
  const [evidenceVersion, setEvidenceVersion] = useState(0);
  const [refreshedDay, setRefreshedDay] = useState<AttendanceResolutionRow | null>(null);
  const [evidenceMessage, setEvidenceMessage] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceReadError, setEvidenceReadError] = useState(false);
  const [showDecisionEvidence, setShowDecisionEvidence] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [bulkDecision, setBulkDecision] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [bulkMultiplier, setBulkMultiplier] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [revisedShiftIn, setRevisedShiftIn] = useState('');
  const [revisedShiftOut, setRevisedShiftOut] = useState('');
  useEffect(() => {
    setLane(initialTriage);
    if (initialCurrentCycle) {
      setStart(startOfMonth(cairoToday()));
      setEnd(cairoToday());
      setBranch('الكل');
      setLane('all');
      setCategoryTab('all');
      return;
    }
    if (!initialDate) return;
    setStart(initialDate);
    setEnd(initialDate);
  }, [initialDate, initialTriage, initialCurrentCycle, initialStaffId]);

  useEffect(() => {
    setRevisedShiftIn(toCairoDateTimeLocal(selected?.scheduled_start_at).slice(11));
    setRevisedShiftOut(toCairoDateTimeLocal(selected?.scheduled_end_at).slice(11));
    setPermissionStart('');
    setPermissionEnd('');
  }, [selected?.staff_id, selected?.attendance_date]);

  // Only the latest load may write: a slower response for previous dates or branch never overwrites a newer one.
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [queue, summary] = await Promise.all([
        listAttendanceExceptionInbox({
          start,
          end,
          branch,
          lane: 'all',
          limit: 1000,
        }),
        getAttendanceDiagnosticSummaryV1({ start, end, branch }),
      ]);
      if (generation !== loadGeneration.current) return;
      setRows(queue);
      setDiagnosticSummary(summary);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      const message = error instanceof Error ? error.message : 'تعذر تحميل صندوق مراجعة الحضور';
      setRows([]);
      setDiagnosticSummary(null);
      setLoadError(message);
      if (!embedded) toast.error(message);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [branch, end, start, embedded]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setShowDecisionEvidence(false);
    if (!selected) {
      setDiagnostic(null);
      setDiagnosticLoading(false);
      setDiagnosticError(false);
      return;
    }
    let active = true;
    setDiagnosticLoading(true);
    setDiagnosticError(false);
    setDiagnostic(null);
    void getAttendanceCaseDiagnosticV1(selected.staff_id, selected.attendance_date)
      .then((result) => { if (active) setDiagnostic(result); })
      .catch(() => { if (active) setDiagnosticError(true); })
      .finally(() => { if (active) setDiagnosticLoading(false); });
    return () => { active = false; };
  }, [selected, evidenceVersion]);

  useEffect(() => {
    const missingType = selected?.resolution_status === 'missing_checkin'
      ? 'check_in'
      : selected?.resolution_status === 'missing_checkout'
        ? 'check_out'
        : null;
    if (!selected || !missingType) {
      setMissingPunchContext(null);
      setMissingPunchHistory([]);
      setMissingPunchLoading(false);
      setManualPunchAt('');
      setApplyMissingPunchPenalty(false);
      return;
    }

    let active = true;
    setMissingPunchLoading(true);
    setApplyMissingPunchPenalty(false);
    const suggested = missingType === 'check_in'
      ? selected.scheduled_start_at
      : selected.scheduled_end_at;
    setManualPunchAt(toCairoDateTimeLocal(suggested));

    void Promise.all([
      getMissingPunchContextV1({
        staffId: selected.staff_id,
        date: selected.attendance_date,
        missingType,
      }),
      listStaffMissingPunchHistoryV1(selected.staff_id, 20),
    ])
      .then(([context, history]) => {
        if (!active) return;
        setMissingPunchContext(context);
        setMissingPunchHistory(history);
      })
      .catch(() => {
        if (!active) return;
        setMissingPunchContext(null);
        setMissingPunchHistory([]);
      })
      .finally(() => { if (active) setMissingPunchLoading(false); });

    return () => { active = false; };
  }, [selected, evidenceVersion]);

  useEffect(() => {
    if (!selected) { setApprovedRequests([]); return; }
    let active = true;
    setRequestsLoading(true);
    setRequestsError(false);
    setApprovedRequests([]);
    void listStaffTimeOffRequests({ staffId: selected.staff_id, from: selected.attendance_date, to: selected.attendance_date, status: 'approved', limit: 100 })
      .then((requests) => { if (active) setApprovedRequests(requests.filter((request) => request.staff_id === selected.staff_id && request.start_date <= selected.attendance_date && request.end_date >= selected.attendance_date)); })
      .catch(() => { if (active) setRequestsError(true); })
      .finally(() => { if (active) setRequestsLoading(false); });
    return () => { active = false; };
  }, [selected, evidenceVersion]);

  useEffect(() => {
    if (!selected || reason !== 'annual_leave') {
      setAnnualLeavePreview(null);
      setAnnualLeavePreviewLoading(false);
      setAnnualLeavePreviewError(false);
      return;
    }
    let active = true;
    setAnnualLeavePreviewLoading(true);
    setAnnualLeavePreviewError(false);
    setAnnualLeavePreview(null);
    void getAnnualLeaveAttendancePreviewV1(selected.staff_id, selected.attendance_date)
      .then((preview) => { if (active) setAnnualLeavePreview(preview); })
      .catch(() => { if (active) setAnnualLeavePreviewError(true); })
      .finally(() => { if (active) setAnnualLeavePreviewLoading(false); });
    return () => { active = false; };
  }, [reason, selected]);

  useEffect(() => {
    const isWeeklyOffSwap = Boolean(
      selected
      && reason === 'shift_swap'
      && (selected.issue_group === 'absence' || selected.resolution_status === 'absence_review')
    );
    if (!selected || !isWeeklyOffSwap) {
      setWeeklyOffSwapPreview(null);
      setWeeklyOffSwapLoading(false);
      setWeeklyOffSwapError(false);
      setSwapWithDate('');
      return;
    }
    let active = true;
    setWeeklyOffSwapLoading(true);
    setWeeklyOffSwapError(false);
    setWeeklyOffSwapPreview(null);
    setSwapWithDate('');
    void getWeeklyOffSwapPreviewV1(selected.staff_id, selected.attendance_date)
      .then((preview) => {
        if (!active) return;
        setWeeklyOffSwapPreview(preview);
        if (preview.off_day_candidates.length === 1) setSwapWithDate(preview.off_day_candidates[0].date);
      })
      .catch(() => { if (active) setWeeklyOffSwapError(true); })
      .finally(() => { if (active) setWeeklyOffSwapLoading(false); });
    return () => { active = false; };
  }, [reason, selected]);

  const scopedRows = useMemo(() => initialStaffId
    ? rows.filter((row) => row.staff_id === initialStaffId && (!initialCurrentCycle || (
      row.attendance_date >= startOfMonth(cairoToday()) && row.attendance_date <= cairoToday()
    )))
    : rows, [rows, initialStaffId, initialCurrentCycle]);
  const formerRows = useMemo(() => scopedRows.filter(isFormerAttendanceReviewRow), [scopedRows]);
  const baseRows = useMemo(
    () => showFormer || initialStaffId ? scopedRows : scopedRows.filter((row) => !isFormerAttendanceReviewRow(row)),
    [scopedRows, showFormer, initialStaffId]
  );
  const priorityCounts = useMemo(() => ({
    p1: baseRows.filter((row) => row.queue_lane === 'manager' && row.priority_code === 'P1').length,
    p2: baseRows.filter((row) => row.queue_lane === 'manager' && row.priority_code === 'P2').length,
    p3: baseRows.filter((row) => row.queue_lane === 'manager' && row.priority_code === 'P3').length,
  }), [baseRows]);
  const tabCounts = useMemo(() => ({
    all: baseRows.length,
    absence: baseRows.filter((row) => row.issue_group === 'absence' || row.resolution_status === 'absence_review').length,
    earlyLeave: baseRows.filter((row) => row.issue_group === 'early_leave' || row.resolution_status === 'early_leave_review').length,
    missingPunch: baseRows.filter((row) => row.issue_group === 'missing_punch' || row.resolution_status?.startsWith('missing_')).length,
    missingCheckIn: baseRows.filter((row) => row.resolution_status === 'missing_checkin').length,
    missingCheckOut: baseRows.filter((row) => row.resolution_status === 'missing_checkout').length,
    system: baseRows.filter((row) => row.queue_lane === 'system').length,
  }), [baseRows]);
  const employeeOptions = useMemo(() => Array.from(new Map(baseRows.map((row) => [row.staff_id, row.staff_name])).entries()).sort((a, b) => a[1].localeCompare(b[1], 'ar')), [baseRows]);
  const visibleRows = baseRows.filter((row) => (lane === 'all' || row.queue_lane === lane) && (staffFilter === 'all' || row.staff_id === staffFilter));
  const displayRows = visibleRows.filter((row) => {
    if (categoryTab === 'absence') return row.issue_group === 'absence' || row.resolution_status === 'absence_review';
    if (categoryTab === 'early_leave') return row.issue_group === 'early_leave' || row.resolution_status === 'early_leave_review';
    if (categoryTab === 'missing_punch') {
      if (missingPunchTab === 'check_in') return row.resolution_status === 'missing_checkin';
      if (missingPunchTab === 'check_out') return row.resolution_status === 'missing_checkout';
      return row.issue_group === 'missing_punch' || row.resolution_status?.startsWith('missing_');
    }
    if (categoryTab === 'system') return row.queue_lane === 'system';
    return true;
  });
  const selectedRows = useMemo(
    () => displayRows.filter((row) => selectedRowIds.has(row.id) && row.queue_lane === 'manager'),
    [displayRows, selectedRowIds]
  );
  const selectableRows = useMemo(
    () => displayRows.filter((row) => row.queue_lane === 'manager'),
    [displayRows]
  );
  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((row) => selectedRowIds.has(row.id));
  const commonBulkDecisions = useMemo(() => {
    if (!selectedRows.length) return [] as Decision[];
    const first = decisionsFor(selectedRows[0]).filter((decision) => BULK_SAFE_DECISION_IDS.has(decision.id));
    return first.filter((decision) =>
      selectedRows.every((row) => decisionsFor(row).some((candidate) => candidate.id === decision.id))
    );
  }, [selectedRows]);

  useEffect(() => {
    if (bulkDecision && !commonBulkDecisions.some((decision) => decision.id === bulkDecision)) {
      setBulkDecision('');
      setBulkMultiplier('');
    }
  }, [bulkDecision, commonBulkDecisions]);

  useEffect(() => {
    setSelectedRowIds(new Set());
    setBulkDecision('');
    setBulkNote('');
    setBulkMultiplier('');
  }, [branch, categoryTab, end, lane, missingPunchTab, showFormer, start]);

  const totals = useMemo(() => ({
    total: visibleRows.length,
    manager: visibleRows.filter((row) => row.queue_lane === 'manager').length,
    system: visibleRows.filter((row) => row.queue_lane === 'system').length,
    missingPunch: visibleRows.filter((row) => row.issue_group === 'missing_punch').length,
    absence: visibleRows.filter((row) => row.issue_group === 'absence').length,
  }), [visibleRows]);

  async function runMaterialization() {
    setMaterializing(true);
    try {
      const result = await materializeAttendanceRange({ start, end, branch });
      toast.success(`تم تحديث حقيقة الحضور: ${Number(result.approved || 0)} يوم معتمد تلقائيًا، ${Number(result.pending_review || 0)} يحتاج مراجعة.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحديث حقيقة الحضور');
    } finally {
      setMaterializing(false);
    }
  }

  async function refreshSelectedEvidence(message = 'تم تحديث الأدلة من قاعدة البيانات') {
    if (!selected || evidenceRefreshLock.current) return;
    evidenceRefreshLock.current = true;
    setEvidenceBusy(true);
    setEvidenceReadError(true);
    setRefreshedDay(null);
    try {
      const day = await getAttendanceDayEvidence(selected.staff_id, selected.attendance_date);
      setRefreshedDay(day);
      setSelected({ ...selected, ...day });
      setHours(day.candidate_hours == null ? '' : String(day.candidate_hours));
      setEvidenceVersion((version) => version + 1);
      setEvidenceReadError(false);
      setEvidenceMessage(message);
      await load();
    } catch (error) {
      setEvidenceMessage('تعذر التحقق من الأدلة. أعد التحديث قبل الاعتماد: ' + (error instanceof Error ? error.message : 'خطأ قراءة'));
      throw error;
    } finally { evidenceRefreshLock.current = false; setEvidenceBusy(false); }
  }

  const finalApprovalReady = Boolean(canApproveDay && refreshedDay && !evidenceReadError && !evidenceBusy
    && !diagnosticLoading && !diagnosticError && diagnostic
    && diagnostic.evidence.canonical_finalizable === true
    && diagnostic.evidence.canonical_route === 'standard_v2'
    && (diagnostic.owner === 'manager' || diagnostic.evidence.canonical_system_resolvable === true)
    && (!requiredPermissionId || refreshedDay.time_off_request_id === requiredPermissionId
      || refreshedDay.resolution_snapshot?.permission_attached === true)
    && refreshedDay.first_in && refreshedDay.last_out
    && refreshedDay.scheduled_start_at && refreshedDay.scheduled_end_at
    && refreshedDay.candidate_hours != null && Number.isFinite(refreshedDay.candidate_hours)
    && refreshedDay.status !== 'approved');

  async function approveRefreshedDay() {
    if (!selected || !finalApprovalReady || mutationLock.current || !note.trim()) return;
    mutationLock.current = true;
    setApproving(true);
    try {
      const [fresh, latestDay] = await Promise.all([
        getAttendanceCaseDiagnosticV1(selected.staff_id, selected.attendance_date),
        getAttendanceDayEvidence(selected.staff_id, selected.attendance_date),
      ]);
      if (!latestDay.first_in || !latestDay.last_out || latestDay.candidate_hours == null
        || latestDay.status === 'approved') throw new Error('بيانات اليوم تغيرت أو لم تكتمل البصمات؛ حدّث الأدلة قبل الاعتماد.');
      if (fresh.evidence.canonical_finalizable !== true || fresh.evidence.canonical_route !== 'standard_v2'
        || (fresh.owner !== 'manager' && fresh.evidence.canonical_system_resolvable !== true)) {
        throw new Error('تغيرت أدلة اليوم أو بقي تعارض. حدّث الأدلة وراجع السبب قبل الاعتماد.');
      }
      const saved = await approveAttendanceResolution({ staffId: selected.staff_id,
        date: selected.attendance_date, payrollEligibleHours: null, requireCompleteEvidence: true, note: note.trim() });
      if (saved?.status !== 'approved') throw new Error('لم تؤكد قاعدة البيانات الاعتماد');
      const verified = await getAttendanceDayEvidence(selected.staff_id, selected.attendance_date);
      if (verified.status !== 'approved') throw new Error('تعذر التحقق من حفظ الاعتماد');
      await load();
      setSelected(null);
      toast.success('تم التحقق من اعتماد اليوم وتحديث قائمة المراجعات.');
      onDecisionSaved?.();
    } catch (error) {
      setEvidenceReadError(true);
      setEvidenceMessage(error instanceof Error ? error.message : 'تعذر اعتماد اليوم');
    } finally { mutationLock.current = false; setApproving(false); }
  }

  async function approveSelected() {
    if (mutationLock.current || evidenceBusy) return;
    mutationLock.current = true;
    try { await approveSelectedUnlocked(); }
    catch (error) { const message = error instanceof Error ? error.message : 'تعذر حفظ القرار'; setEvidenceMessage(message); toast.error(message); }
    finally { mutationLock.current = false; }
  }

  async function approveSelectedUnlocked() {
    if (!selected || refreshedDay?.status === 'approved' || evidenceReadError) return;
    if (selected.queue_lane !== 'manager') {
      toast.warning('هذه مشكلة نظام وليست قرار موظف. أصلح السبب النظامي أولًا.');
      return;
    }
    const decision = decisionsFor(selected).find((item) => item.id === reason);
    if (!decision || (['custom', 'outside_work'].includes(decision.id) && !note.trim())) {
      toast.warning('اختر نوع القرار، واكتب التفاصيل فقط عند إثبات عمل خارج الفرع أو اختيار سبب آخر.');
      return;
    }
    if (decision.id === 'annual_leave') {
      if (annualLeavePreviewLoading || annualLeavePreviewError) {
        toast.error('تعذر التأكد من رصيد الإجازة السنوية. أعد فتح القرار وحاول مرة أخرى.');
        return;
      }
      setApproving(true);
      try {
        const result = await resolveAnnualLeaveFromAttendanceV1({
          staffId: selected.staff_id,
          date: selected.attendance_date,
          note: note.trim() || null,
        });
        const summary = result.preview;
        toast.success(
          `تم اعتماد الإجازة السنوية وتسجيلها في السجل. المستخدم سنويًا: ${summary.year_used} يوم · المستخدم هذا الشهر: ${summary.calendar_month_used} يوم`
        );
        setSelected(null);
        setNote('');
        setReason('');
        setMultiplier('');
        setHours('');
        setAnnualLeavePreview(null);
        await load();
        onDecisionSaved?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر اعتماد الإجازة السنوية';
        if (message.includes('annual_leave_not_configured') || message.includes('annual_leave_policy_not_configured') || message.includes('annual_leave_entitlement_not_configured')) {
          toast.error('لا يمكن اعتماد الإجازة السنوية قبل تفعيل رصيد الموظف.');
        } else if (message.includes('annual_leave_insufficient_balance')) {
          toast.error('رصيد الإجازة السنوية لا يكفي لاعتماد هذا اليوم.');
        } else if (message.includes('overlapping_approved_full_day_timeoff')) {
          toast.error('يوجد بالفعل إجازة أو غياب معتمد متداخل مع هذا اليوم.');
        } else {
          toast.error(message);
        }
      } finally {
        setApproving(false);
      }
      return;
    }

    if (['sick_leave', 'exceptional_leave', 'approved_absence'].includes(decision.id)) {
      setApproving(true);
      try {
        const result = await approveAttendanceFullDayTimeOffV1({
          staffId: selected.staff_id,
          date: selected.attendance_date,
          requestKind: decision.id as 'sick_leave' | 'exceptional_leave' | 'approved_absence',
          note: note.trim() || null,
        });
        toast.success(`تم اعتماد ${result.request_label} وتسجيله في سجل الإجازات والغياب، وتم تحديث حقيقة الحضور.`);
        setSelected(null);
        setNote('');
        setReason('');
        setMultiplier('');
        setHours('');
        await load();
        onDecisionSaved?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر اعتماد الإجازة/الغياب';
        if (message.includes('overlapping_approved_full_day_timeoff') || message.includes('time_off_preflight_blocked')) {
          toast.error('يوجد إجازة أو غياب معتمد متداخل مع هذا اليوم. راجع السجل قبل الاعتماد.');
        } else {
          toast.error(message);
        }
      } finally {
        setApproving(false);
      }
      return;
    }

    const isWeeklyOffSwap = decision.id === 'shift_swap'
      && (selected.issue_group === 'absence' || selected.resolution_status === 'absence_review');
    if (isWeeklyOffSwap) {
      if (weeklyOffSwapLoading || weeklyOffSwapError || !weeklyOffSwapPreview) {
        toast.error('تعذر تحميل أيام الراحة لهذا الأسبوع. أغلق القرار وافتحه مرة أخرى.');
        return;
      }
      if (!swapWithDate) {
        toast.warning('اختر يوم الراحة الأصلي الذي سيتم تبديله مع يوم الغياب الحالي.');
        return;
      }
      setApproving(true);
      try {
        await resolveWeeklyOffSwapFromAttendanceV1({
          staffId: selected.staff_id,
          date: selected.attendance_date,
          swapWithDate,
          note: note.trim() || null,
        });
        const target = weeklyOffSwapPreview.off_day_candidates.find((item) => item.date === swapWithDate);
        toast.success(`تم تغيير يوم الراحة: ${selected.attendance_date} أصبح راحة، و${target?.day_name || swapWithDate} أصبح يوم عمل، وتم تحديث حقيقة الحضور.`);
        setSelected(null);
        setNote('');
        setReason('');
        setMultiplier('');
        setHours('');
        setSwapWithDate('');
        setWeeklyOffSwapPreview(null);
        await load();
        onDecisionSaved?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر تغيير يوم الراحة';
        if (message.includes('target_must_be_existing_off_day')) {
          toast.error('اليوم المختار لم يعد يوم الراحة المعتمد. أعد فتح القرار لتحديث الجدول.');
        } else if (message.includes('existing_override_conflict')) {
          toast.error('يوجد أكثر من تعديل جدول متعارض على أحد اليومين ويحتاج مراجعة الجدول أولًا.');
        } else if (message.includes('conflicts_with_approved_time_off')) {
          toast.error('أحد اليومين عليه إجازة أو غياب معتمد بالفعل، لذلك لا يمكن تبديل الراحة قبل مراجعة التعارض.');
        } else {
          toast.error(message);
        }
      } finally {
        setApproving(false);
      }
      return;
    }

    if (['forgot_in', 'forgot_out'].includes(decision.id)) {
      const missingType = decision.id === 'forgot_in' ? 'check_in' : 'check_out';
      if (!manualPunchAt) {
        toast.warning('حدد وقت البصمة اليدوية بعد مراجعة الدليل.');
        return;
      }
      if (missingPunchLoading || !missingPunchContext) {
        toast.error('تعذر تحميل سجل نسيان البصمة. أغلق القرار وافتحه مرة أخرى.');
        return;
      }
      if (applyMissingPunchPenalty && !missingPunchContext.penalty_eligible) {
        toast.warning('أول مرتين نسيان بصمة في الدورة سماح، ولا يمكن تنفيذ خصم 50 جنيه قبل الواقعة الثالثة.');
        return;
      }
      if (applyMissingPunchPenalty && !missingPunchContext.can_apply_deduction) {
        toast.error('تنفيذ خصم 50 جنيه يحتاج صلاحية مالية معتمدة.');
        return;
      }

      const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(manualPunchAt);
      const manualDate = parts && cairoWallClockToDate(+parts[1], +parts[2], +parts[3], +parts[4], +parts[5]);
      if (!manualDate || !note.trim()) { toast.warning('حدد وقت بصمة صالحًا بتوقيت القاهرة واكتب الدليل وسبب التصحيح.'); return; }
      const manualIso = manualDate.toISOString();
      setEvidenceReadError(true);
      setApproving(true);
      try {
        const result = await resolveMissingPunchIncidentV1({
          staffId: selected.staff_id,
          date: selected.attendance_date,
          missingType,
          recordedAt: manualIso,
          reason: note.trim() || decision.label,
          applyDeduction: applyMissingPunchPenalty,
        });
        const occurrence = Number(result.occurrence_no || missingPunchContext.occurrence_no);
        toast.success(
          applyMissingPunchPenalty
            ? `تم تسجيل البصمة اليدوية وتسجيل واقعة النسيان رقم ${occurrence} وتنفيذ خصم 50 جنيه.`
            : `تم تسجيل البصمة اليدوية وواقعة النسيان رقم ${occurrence} في سجل الموظف.`
        );
        await refreshSelectedEvidence('تم حفظ البصمة. راجع النتيجة قبل الاعتماد النهائي.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر معالجة البصمة المفقودة';
        if (message.includes('missing_punch_allowance_not_exhausted')) {
          toast.error('أول مرتين نسيان بصمة سماح في الدورة الحالية؛ الخصم يبدأ من الواقعة الثالثة.');
        } else if (message.includes('manual_punch_time')) {
          toast.error('وقت البصمة اليدوية غير صالح لهذا اليوم.');
        } else {
          toast.error(message);
        }
      } finally {
        setApproving(false);
      }
      return;
    }

    // Inline permission flow: explicit clock range + documented reason, with
    // existing server preflight and approval. No client-side payroll shortcuts.
    if (decision.id === 'permission' && !approvedRequests.some((request) => request.request_kind === 'permission')) {
      if (requestsLoading || requestsError) {
        toast.error('تعذر التأكد من الأذونات السابقة؛ لا يمكن إنشاء إذن مكرر قبل استكمال الفحص.');
        return;
      }
      const validClock = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!validClock.test(permissionStart) || !validClock.test(permissionEnd) || permissionEnd <= permissionStart || !note.trim()) {
        toast.warning('حدد بداية ونهاية الإذن في نفس اليوم، واكتب سببًا واضحًا قبل الحفظ.');
        return;
      }
      setApproving(true);
      setEvidenceReadError(true);
      try {
        const result = await resolveAttendancePermission({ staffId: selected.staff_id,
          date: selected.attendance_date, start: permissionStart, end: permissionEnd, note: note.trim() });
        setRequiredPermissionId(result.request.id);
        if (!result.approved) {
          const message = 'تم تسجيل طلب الإذن للمراجعة فقط، ولم يُعتمد: ' +
            (result.preflight?.blockers.map((item) => item.label).join('، ') || 'السياسة تمنع اعتماده');
          setEvidenceMessage(message); toast.warning(message);
          await load(); return;
        }
        await refreshSelectedEvidence('تم اعتماد الإذن عبر المسار الرسمي. راجع النتيجة قبل اعتماد اليوم.');
      } catch (error) {
        const message = 'تعذر إكمال الاعتماد: ' + (error instanceof Error ? error.message : 'راجع حالة الإذن قبل إعادة المحاولة');
        setEvidenceMessage(message); toast.error(message);
        await load();
      } finally {
        setApproving(false);
      }
      return;
    }
    const linkedRequest = decision.requestKind && approvedRequests.find((request) => request.request_kind === decision.requestKind);
    if (decision.requestKind && !decision.schedule && (requestsLoading || requestsError || !linkedRequest)) {
      toast.error('سجّل الطلب واعتمده في صفحة الإجازات والغياب أولًا، ثم راجع اليوم مجددًا.');
      return;
    }
    if (decision.id === 'permission' && linkedRequest) {
      if (!note.trim() || !linkedRequest.start_time || !linkedRequest.end_time) {
        toast.warning('اكتب سبب إعادة حساب الإذن وتأكد من وجود بدايته ونهايته.'); return;
      }
      setEvidenceReadError(true);
      await resolveAttendancePermission({ staffId: selected.staff_id, date: selected.attendance_date,
        start: linkedRequest.start_time.slice(0, 5), end: linkedRequest.end_time.slice(0, 5), note: note.trim() });
      setRequiredPermissionId(linkedRequest.id);
      await refreshSelectedEvidence('تم تحديث الإذن المرتبط. استخدم زر الاعتماد النهائي بعد مراجعة الأدلة.');
      return;
    }
    if (decision.requestKind && !decision.schedule && decision.requestKind !== 'permission') {
      toast.warning('الطلب معتمد. حدّث حقيقة الحضور أولًا ليُحتسب بنوع الإجازة الصحيح بدل اعتماد صفر ساعات من هذه الشاشة.');
      return;
    }
    if (decision.schedule) {
      const timeFormat = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!timeFormat.test(revisedShiftIn) || !timeFormat.test(revisedShiftOut) ||
          revisedShiftIn === revisedShiftOut || note.trim().length < 5) {
        toast.warning('حدد وقتي بداية ونهاية الشيفت واكتب سبب التعديل (5 أحرف على الأقل).');
        return;
      }
      if (!window.confirm(`سيتم تعديل شيفت ${selected.staff_name} بتاريخ ${selected.attendance_date} فقط، دون تغيير الأسابيع التالية. ستعاد مراجعة البصمات ولن يعتمد اليوم تلقائيًا إذا بقي تعارض. هل تؤكد؟`)) return;
      setApproving(true);
      try {
        setEvidenceReadError(true);
        await resolveDatedAttendanceShift({ staffId: selected.staff_id, date: selected.attendance_date,
          start: revisedShiftIn, end: revisedShiftOut, note: note.trim() });
        await refreshSelectedEvidence('تم حفظ شيفت هذا اليوم. راجع الأدلة والساعات ثم اعتمد القرار النهائي.');
        setReason('');
      } catch (error) {
        const message = 'لم يتم تأكيد تعديل الشيفت أو تحديث أدلته: ' + (error instanceof Error ? error.message : 'تعذر الحفظ');
        setEvidenceMessage(message); toast.error(message);
      } finally {
        setApproving(false);
      }
      return;
    }
    if (decision.financial && !note.trim()) {
      toast.warning('اكتب سبب اقتراح الخصم ودليل المخالفة قبل حفظ القرار.');
      return;
    }
    if (decision.financial && !['1', '2', '4'].includes(multiplier)) {
      toast.warning('حدد معامل الخصم المقترح للمراجعة المالية.');
      return;
    }
    const decisionNote = [
      `تصنيف مراجعة الحضور: ${decision.label}`,
      linkedRequest ? `طلب معتمد: ${linkedRequest.id}` : '',
      decision.financial ? `معامل الخصم المقترح: ×${multiplier} (للمراجعة المالية فقط؛ لم يطبق خصم)` : '',
      note.trim() ? `تفاصيل المدير: ${note.trim()}` : '',
    ].filter(Boolean).join(' | ');
    const parsedHours = hours.trim() === '' ? null : Number(hours);
    if (parsedHours != null && (!Number.isFinite(parsedHours) || parsedHours < 0 || parsedHours > 18)) {
      toast.error('ساعات الاستحقاق يجب أن تكون بين 0 و18 ساعة.');
      return;
    }

    setApproving(true);
    try {
      await approveAttendanceResolution({
        staffId: selected.staff_id,
        date: selected.attendance_date,
        payrollEligibleHours: parsedHours,
        note: decisionNote,
      });
      toast.success(decision.financial
        ? 'تم توثيق الحضور واقتراح معامل الخصم. لم يُطبق أي خصم مالي.'
        : 'تم اعتماد قرار الحضور وحفظ السبب في سجل المراجعة.');
      setSelected(null);
      setNote('');
      setReason('');
      setMultiplier('');
      setHours('');
      await load();
      onDecisionSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر اعتماد قرار الحضور');
    } finally {
      setApproving(false);
    }
  }

  async function approveBulkSelected() {
    if (!selectedRows.length) {
      toast.warning('حدد حالة واحدة على الأقل تحتاج قرار مدير.');
      return;
    }
    const decision = commonBulkDecisions.find((item) => item.id === bulkDecision);
    if (!decision) {
      toast.warning('اختر قرارًا جماعيًا متاحًا لكل الحالات المحددة.');
      return;
    }
    if (['custom', 'outside_work'].includes(decision.id) && !bulkNote.trim()) {
      toast.warning('اكتب ملاحظة موحدة توضح سبب القرار للحالات المحددة.');
      return;
    }
    if (decision.financial && !bulkNote.trim()) {
      toast.warning('اكتب سببًا موثقًا للخصم المقترح قبل الاعتماد الجماعي.');
      return;
    }
    if (decision.financial && !['1', '2', '4'].includes(bulkMultiplier)) {
      toast.warning('حدد معامل الخصم المقترح قبل التنفيذ الجماعي.');
      return;
    }
    if (!window.confirm(`سيتم تطبيق "${decision.label}" على ${selectedRows.length.toLocaleString('ar-EG')} حالة. كل حالة ستخضع لنفس فحوصات الصلاحية والسياسات. هل تريد المتابعة؟`)) {
      return;
    }

    setBulkBusy(true);
    let successCount = 0;
    const failedIds = new Set<string>();
    const failedNames: string[] = [];

    for (const row of selectedRows) {
      try {
        if (decision.id === 'annual_leave') {
          await resolveAnnualLeaveFromAttendanceV1({
            staffId: row.staff_id,
            date: row.attendance_date,
            note: bulkNote.trim() || null,
          });
        } else if (['sick_leave', 'exceptional_leave', 'approved_absence'].includes(decision.id)) {
          await approveAttendanceFullDayTimeOffV1({
            staffId: row.staff_id,
            date: row.attendance_date,
            requestKind: decision.id as 'sick_leave' | 'exceptional_leave' | 'approved_absence',
            note: bulkNote.trim() || null,
          });
        } else {
          const decisionNote = [
            `تصنيف مراجعة الحضور: ${decision.label}`,
            decision.financial ? `معامل الخصم المقترح: ×${bulkMultiplier} (للمراجعة المالية فقط؛ لم يطبق خصم)` : '',
            bulkNote.trim() ? `تفاصيل المدير: ${bulkNote.trim()}` : '',
            `اعتماد جماعي موثق — ${arabicWeekday(row.attendance_date)} ${row.attendance_date}`,
          ].filter(Boolean).join(' | ');

          await approveAttendanceResolution({
            staffId: row.staff_id,
            date: row.attendance_date,
            payrollEligibleHours: row.candidate_hours == null ? null : Number(row.candidate_hours),
            note: decisionNote,
          });
        }
        successCount += 1;
      } catch (error) {
        failedIds.add(row.id);
        failedNames.push(row.staff_name);
        console.warn('[attendance bulk approval] failed', row.id, error);
      }
    }

    setSelectedRowIds(failedIds);
    if (!failedIds.size) {
      setBulkDecision('');
      setBulkNote('');
      setBulkMultiplier('');
      toast.success(`تم اعتماد ${successCount.toLocaleString('ar-EG')} حالة بنجاح.`);
    } else {
      toast.warning(
        `تم اعتماد ${successCount.toLocaleString('ar-EG')} حالة، وتعذر اعتماد ${failedIds.size.toLocaleString('ar-EG')} حالة. الحالات غير المعتمدة ما زالت محددة للمراجعة: ${failedNames.slice(0, 3).join('، ')}${failedNames.length > 3 ? '…' : ''}`
      );
    }
    await load();
    setBulkBusy(false);
  }

  useEffect(() => {
    if (embedded && selected) selectedPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [embedded, selected?.id]);

  const currentLaneMeta = lane === 'system' ? laneMeta('system') : laneMeta('manager');

  return (
    <div className="space-y-4">
      {!embedded && <AttendanceShiftMismatchReview start={start} end={end} branch={branch} staffId={staffFilter} />}
      {embedded ? (
        <section className="space-y-3" aria-label="مراجعات الموظف في الدورة الحالية">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-black text-[var(--dawaa-theme-heading)]">مراجعات الدورة الحالية</h3>
            <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary text-xs">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث الحالات
            </button>
          </div>
          <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
            من {start} إلى {end} · الموظف المحدد فقط · لا خصم أو اعتماد تلقائي
          </p>
          {loading && <p role="status" className="text-xs font-bold text-[var(--dawaa-theme-muted)]">جارٍ تحميل المراجعات...</p>}
          {loadError && <p role="alert" className="rounded-xl border border-[var(--dawaa-status-danger-border)] p-3 text-xs font-bold text-[var(--dawaa-status-danger-text)]">
            تعذر قراءة المراجعات: {loadError} · لا يعني ذلك عدم وجود حالات
          </p>}
          {!loading && !loadError && rows.length >= 1000 && <p role="alert" className="text-xs font-bold text-[var(--dawaa-status-warning-text)]">
            صندوق المراجعات العام وصل إلى حد 1000 حالة؛ قد يلزم تدقيق تغطية النتائج قبل اعتبار القائمة كاملة.
          </p>}
          {!loading && !loadError && <div className="space-y-2">
            {baseRows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-3 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="font-black text-[var(--dawaa-theme-heading)]">{row.attendance_date} · {row.issue_label}</div>
                  <div className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
                    {row.queue_lane === 'system' ? 'فحص نظام، وليس مخالفة موظف' : 'يحتاج قرار المدير'}
                    {' · '}{row.raw_events} بصمة · {fmt(row.first_in)} ← {fmt(row.last_out)}
                  </div>
                </div>
                <button type="button" className="btn-secondary text-xs"
                  disabled={approving || evidenceBusy} onClick={() => { setRequiredPermissionId(null); setRefreshedDay(null); setEvidenceMessage(''); setEvidenceReadError(false); setSelected(row); setHours(row.candidate_hours == null ? '' : String(row.candidate_hours)); setNote(''); setReason(''); setMultiplier(''); }}>
                  {row.queue_lane === 'system' ? 'عرض السبب' : 'مراجعة الحالة'}
                </button>
              </div>
            ))}
            {!baseRows.length && <p role="status" className="rounded-xl border border-[var(--dawaa-theme-border)] p-4 text-xs font-bold text-[var(--dawaa-theme-muted)]">
              لا توجد مراجعات ظاهرة لهذا الموظف في الدورة الحالية.
            </p>}
          </div>}
        </section>
      ) : (<>
      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1">
            <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Exception Inbox V2</div>
            <h2 className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">صندوق مراجعة الحضور</h2>
            <p className="mt-1 text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
              الموظف السليم لا يظهر هنا. نفصل قرار المدير عن مشكلة النظام، ومشكلة النظام لا تتحول تلقائيًا إلى مخالفة أو خصم.
            </p>
            {initialStaffId && <p role="status" className="mt-2 rounded-lg border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-3 py-2 text-xs font-bold text-[var(--dawaa-status-info-text)]">
              مراجعات الموظف المحدد فقط · {initialCurrentCycle ? 'الدورة الحالية 26 → 25 حتى اليوم' : 'الفترة المختارة'} · قرارات المدير ومشاكل النظام
            </p>}
          </div>

          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
            من
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={initialCurrentCycle} className="input-dark mt-1 block" />
          </label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
            إلى
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={initialCurrentCycle} className="input-dark mt-1 block" />
          </label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
            المسار
            <select value={lane} onChange={(e) => setLane(e.target.value as 'all' | AttendanceExceptionLane)} className="input-dark mt-1 block">
              <option value="manager">يحتاج قرار مدير</option>
              <option value="system">مشكلة نظام</option>
              <option value="all">الكل</option>
            </select>
          </label>
          <button onClick={() => void load()} className="btn-secondary">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
          {!initialStaffId && <button onClick={() => void runMaterialization()} disabled={materializing} className="btn-primary">
            <ShieldCheck size={16} className={materializing ? 'animate-pulse' : ''} /> تحديث حقيقة الحضور
          </button>}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">الفرع
            <select value={branch} onChange={(e) => { setBranch(e.target.value); setStaffFilter('all'); }} disabled={!!initialStaffId} className="input-dark mt-1 block w-full">
              <option value="الكل">كل الفروع</option>
              {Array.from(new Set(rows.map((row) => row.staff_branch || row.branch).filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b, 'ar')).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">الموظف
            <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} disabled={!!initialStaffId} className="input-dark mt-1 block w-full">
              <option value="all">كل الموظفين</option>
              {employeeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        </div>

        {!initialStaffId && <label className="mt-3 flex items-center gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">
          <input type="checkbox" checked={showFormer} onChange={(e) => setShowFormer(e.target.checked)} />
          إظهار الموظفين السابقين ({formerRows.length} يوم معلّق في النطاق الحالي)
        </label>}
        {!initialStaffId && formerRows.length > 0 && !showFormer && <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">أيام الموظفين السابقين محفوظة للمراجعة التاريخية، ولا تُلغى من جاهزية الرواتب بمجرد إخفائها هنا.</p>}
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black">
          <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-1 text-[var(--dawaa-status-warning-text)]">P1 عاجل: {priorityCounts.p1.toLocaleString('ar-EG')}</span>
          <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-1 text-[var(--dawaa-theme-heading)]">P2: {priorityCounts.p2.toLocaleString('ar-EG')}</span>
          <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-1 text-[var(--dawaa-theme-muted)]">P3: {priorityCounts.p3.toLocaleString('ar-EG')}</span>
          <span className="px-1 py-1 text-[var(--dawaa-theme-muted)]">الترتيب صادر من عقد الأولوية المركزي، والأقدم داخل نفس الأولوية يظهر أولًا.</span>
        </div>

        <div className={`mt-3 rounded-xl border p-3 text-xs font-bold ${lane === 'all' ? 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]' : currentLaneMeta.className}`}>
          {lane === 'all'
            ? 'تعرض هذه النظرة قرارات المدير ومشاكل النظام معًا. استخدم المسارات المنفصلة للعمل اليومي.'
            : currentLaneMeta.description}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="إجمالي الاستثناءات" value={totals.total} icon={Clock3} />
        <Metric label="تحتاج قرار مدير" value={totals.manager} icon={AlertTriangle} tone="warn" />
        <Metric label="مشاكل نظام" value={totals.system} icon={Wrench} tone="info" />
        <Metric label="بصمات ناقصة" value={totals.missingPunch} icon={Clock3} />
        <Metric label="غياب محتمل" value={totals.absence} icon={AlertTriangle} tone="warn" />
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'الكل', count: tabCounts.all },
            { id: 'absence', label: 'غياب', count: tabCounts.absence },
            { id: 'early_leave', label: 'خروج مبكر', count: tabCounts.earlyLeave },
            { id: 'missing_punch', label: 'بصمة مفقودة', count: tabCounts.missingPunch },
            { id: 'system', label: 'مشاكل نظام', count: tabCounts.system },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setCategoryTab(tab.id as typeof categoryTab);
                if (tab.id === 'system') setLane('system');
                else setLane('all');
              }}
              className={`rounded-xl border px-4 py-2 text-xs font-black transition ${categoryTab === tab.id
                ? 'border-[var(--dawaa-theme-primary)] bg-[var(--dawaa-theme-primary-soft)] text-[var(--dawaa-theme-primary-strong)]'
                : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]'}`}
            >
              {tab.label}
              <span className="ms-2 rounded-full border border-current px-2 py-0.5 text-[10px]">{tab.count.toLocaleString('ar-EG')}</span>
            </button>
          ))}
        </div>
        {categoryTab === 'missing_punch' && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--dawaa-theme-border)] pt-3">
            {[
              { id: 'all', label: 'كل البصمات المفقودة', count: tabCounts.missingPunch },
              { id: 'check_in', label: 'دخول بدون بصمة', count: tabCounts.missingCheckIn },
              { id: 'check_out', label: 'خروج بدون بصمة', count: tabCounts.missingCheckOut },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMissingPunchTab(tab.id as typeof missingPunchTab)}
                className={`rounded-lg border px-3 py-1.5 text-[11px] font-black ${missingPunchTab === tab.id
                  ? 'border-[var(--dawaa-theme-primary)] text-[var(--dawaa-theme-primary-strong)]'
                  : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]'}`}
              >
                {tab.label} <span className="ms-1">({tab.count.toLocaleString('ar-EG')})</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
          الأرقام تمثل عدد الحالات في الفترة والفرع المحددين. اختر التاب لمراجعة المسار يوميًا.
        </p>
      </section>

      {diagnosticSummary && diagnosticSummary.causes.length > 0 && (
        <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Diagnostic Engine V1</div>
              <h3 className="mt-1 text-base font-black text-[var(--dawaa-theme-heading)]">أسباب التعليق الحالية</h3>
            </div>
            <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
              مدير: {diagnosticSummary.manager_cases.toLocaleString('ar-EG')} · نظام: {diagnosticSummary.system_cases.toLocaleString('ar-EG')}
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {diagnosticSummary.causes.slice(0, 6).map((cause) => (
              <div key={`${cause.code}-${cause.owner}`} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-[var(--dawaa-theme-heading)]">{cause.label}</div>
                    <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{cause.code}</div>
                  </div>
                  <span className="text-lg font-black text-[var(--dawaa-theme-heading)]">{cause.cases.toLocaleString('ar-EG')}</span>
                </div>
                <div className="mt-2 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
                  المسئول: {cause.owner === 'system' ? 'إصلاح نظامي' : 'قرار مدير'}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <AttendanceCorrectionReviewPanel branch={branch} />

      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <label className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-heading)]">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={!selectableRows.length || bulkBusy}
              onChange={(event) => {
                setSelectedRowIds((current) => {
                  const next = new Set(current);
                  for (const row of selectableRows) {
                    if (event.target.checked) next.add(row.id);
                    else next.delete(row.id);
                  }
                  return next;
                });
              }}
            />
            تحديد كل الحالات الظاهرة التي تحتاج قرار مدير
          </label>

          <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
            المحدد: <b className="text-[var(--dawaa-theme-heading)]">{selectedRows.length.toLocaleString('ar-EG')}</b>
          </div>

          <label className="min-w-[260px] text-xs font-black text-[var(--dawaa-theme-muted)]">
            القرار الجماعي
            <select
              value={bulkDecision}
              disabled={!selectedRows.length || bulkBusy}
              onChange={(event) => {
                setBulkDecision(event.target.value);
                setBulkMultiplier('');
              }}
              className="input-dark mt-1 w-full"
            >
              <option value="">اختر قرارًا مشتركًا للحالات المحددة</option>
              {commonBulkDecisions.map((decision) => (
                <option key={decision.id} value={decision.id}>{decision.label}</option>
              ))}
            </select>
          </label>

          {commonBulkDecisions.find((decision) => decision.id === bulkDecision)?.financial && (
            <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
              معامل الخصم المقترح
              <select value={bulkMultiplier} onChange={(event) => setBulkMultiplier(event.target.value)} className="input-dark mt-1 block">
                <option value="">اختر</option>
                <option value="1">×1</option>
                <option value="2">×2</option>
                <option value="4">×4</option>
              </select>
            </label>
          )}

          <label className="min-w-[260px] flex-1 text-xs font-black text-[var(--dawaa-theme-muted)]">
            ملاحظة موحدة
            <input
              value={bulkNote}
              disabled={!selectedRows.length || bulkBusy}
              onChange={(event) => setBulkNote(event.target.value)}
              placeholder={commonBulkDecisions.find((decision) => decision.id === bulkDecision)?.financial ? 'إجباري: سبب الخصم والدليل' : 'إجباري للسبب الآخر أو العمل الخارجي'}
              className="input-dark mt-1 w-full"
            />
          </label>

          <button
            type="button"
            disabled={!selectedRows.length || !bulkDecision || bulkBusy}
            onClick={() => void approveBulkSelected()}
            className="btn-primary whitespace-nowrap"
          >
            <CheckCircle2 size={16} className={bulkBusy ? 'animate-pulse' : ''} />
            اعتماد المحدد ({selectedRows.length.toLocaleString('ar-EG')})
          </button>
        </div>

        {!!selectedRows.length && !commonBulkDecisions.length && (
          <p className="mt-2 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
            الحالات المحددة لا تشترك في قرار جماعي آمن. اختر حالات من نفس النوع، أو راجعها فرديًا.
          </p>
        )}
        <p className="mt-2 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
          نسيان البصمة وتغيير يوم الراحة/الجدول لا يتمان جماعيًا لأن كل حالة تحتاج وقتًا أو اختيارًا فرديًا. أي حالة تفشل في الفحص تظل محددة للمراجعة.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="كروت مراجعة الحضور">
        {displayRows.map((row) => {
          const meta = laneMeta(row.queue_lane);
          return (
            <article key={row.id} className={`flex flex-col gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm ${selectedRowIds.has(row.id) ? 'ring-2 ring-[var(--dawaa-theme-primary)]' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <button type="button" onClick={() => setProfileStaffId(row.staff_id)} className="text-right text-base font-black text-[var(--dawaa-theme-heading)] hover:underline">{row.staff_name}</button>
                  <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{row.staff_branch || row.branch || 'فرع غير محدد'} · {row.attendance_date} · {arabicWeekday(row.attendance_date)}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${meta.className}`}>{meta.label}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-black text-[var(--dawaa-theme-heading)]">{row.issue_label}</span>
                {row.priority_code && row.priority_code !== 'former_staff' && <span className="rounded-md border border-[var(--dawaa-theme-border)] px-2 py-0.5">{row.priority_code}</span>}
                {row.age_days != null && <span className="text-[10px] text-[var(--dawaa-theme-muted)]">انتظار {row.age_days.toLocaleString('ar-EG')} يوم</span>}
                {isFormerAttendanceReviewRow(row) && <span className="text-[var(--dawaa-status-warning-text)]">موظف سابق</span>}
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-[var(--dawaa-theme-surface-2)] p-2 text-center text-xs">
                <div><p className="text-[10px] text-[var(--dawaa-theme-muted)]">الدخول</p><strong className="break-words">{fmt(row.first_in)}</strong></div>
                <div><p className="text-[10px] text-[var(--dawaa-theme-muted)]">الخروج</p><strong className="break-words">{fmt(row.last_out)}</strong></div>
                <div><p className="text-[10px] text-[var(--dawaa-theme-muted)]">الساعات</p><strong>{row.candidate_hours == null ? '-' : row.candidate_hours.toFixed(2)}</strong></div>
              </div>
              <p className="text-[11px] text-[var(--dawaa-theme-muted)]">{row.raw_events.toLocaleString('ar-EG')} بصمة خام · الدليل محفوظ</p>
              <div className="mt-auto flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-[var(--dawaa-theme-muted)]">
                  <input type="checkbox" checked={selectedRowIds.has(row.id)} disabled={row.queue_lane !== 'manager' || bulkBusy} aria-label={`اختيار حالة ${row.staff_name} بتاريخ ${row.attendance_date}`}
                    onChange={(event) => setSelectedRowIds((current) => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} />
                  تحديد
                </label>
                <button type="button" disabled={approving || evidenceBusy} onClick={() => { setRequiredPermissionId(null); setRefreshedDay(null); setEvidenceMessage(''); setEvidenceReadError(false); setSelected(row); setHours(row.candidate_hours == null ? '' : String(row.candidate_hours)); setNote(''); setReason(''); setMultiplier(''); }} className="btn-secondary text-xs">
                  {row.queue_lane === 'manager' ? 'اتخاذ قرار' : 'تشخيص الحالة'}
                </button>
              </div>
            </article>
          );
        })}
        {!displayRows.length && !loading && <div className="col-span-full rounded-2xl border border-[var(--dawaa-theme-border)] p-8 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">لا توجد حالات مطابقة للفلاتر خلال الفترة المحددة.</div>}
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4 text-xs font-bold text-[var(--dawaa-status-info-text)]">
        الحضور يثبت الحقيقة التشغيلية أولًا. الخصومات العامة تمر من مسار الرواتب/الجزاءات؛ والاستثناء الوحيد هنا هو خصم نسيان البصمة الثابت 50ج بعد تجاوز مرتين السماح، لأنه مرتبط مباشرة بسجل الواقعة وممنوع تكراره لنفس البصمة.
      </section>

      </>)}

      {selected && (
        <div ref={selectedPanelRef} className={embedded
          ? 'scroll-mt-4 rounded-2xl border border-[var(--dawaa-theme-border)]'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3'}>
          <div className={embedded
            ? 'w-full rounded-2xl dawaa-surface'
            : 'max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-2xl'}>
            <div className="sticky top-0 z-10 border-b border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-[var(--dawaa-theme-heading)]">قرار حضور — {selected.staff_name}</h3>
                  <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                    {arabicWeekday(selected.attendance_date)} · {selected.attendance_date} · {selected.staff_branch || selected.branch || '-'}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-1 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">
                  {selected.issue_label}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2">
                  <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الشيفت</div>
                  <div className="mt-1 font-black">{fmt(selected.scheduled_start_at)} → {fmt(selected.scheduled_end_at)}</div>
                </div>
                <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2">
                  <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الدخول</div>
                  <div className="mt-1 font-black">{fmt(selected.first_in)}</div>
                </div>
                <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2">
                  <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الخروج</div>
                  <div className="mt-1 font-black">{fmt(selected.last_out)}</div>
                </div>
                <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2">
                  <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">ساعات مرشحة</div>
                  <div className="mt-1 font-black">{selected.candidate_hours == null ? '-' : selected.candidate_hours.toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div className="p-4">
              <div className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-2.5 text-[11px] font-bold text-[var(--dawaa-status-warning-text)]">
                هذا اعتماد لحقيقة الحضور، وليس خصمًا ماليًا تلقائيًا.
              </div>

              <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs" aria-live="polite">
                {evidenceMessage && <p role="status" className="mb-2 font-bold">{evidenceMessage}</p>}
                {refreshedDay?.status === 'approved' && <p>اليوم معتمد في قاعدة البيانات. لا يمكن تعديله من هذا المسار.</p>}
                {refreshedDay && <p>الساعات المستحقة: {refreshedDay.payroll_eligible_hours ?? 'بانتظار الاعتماد'} · النتيجة: {diagnostic?.title || 'جارٍ تحديث التشخيص'}</p>}
                <button type="button" className="btn-secondary mt-2" disabled={approving || evidenceBusy}
                  onClick={() => { void refreshSelectedEvidence().catch(() => undefined); }}>تحديث أدلة اليوم</button>
                {requiredPermissionId && refreshedDay?.resolution_snapshot?.permission_attached !== true && refreshedDay?.time_off_request_id !== requiredPermissionId && <p className="mt-2">بانتظار ظهور الإذن في نتيجة إعادة حساب الحضور؛ لا تعتمد الساعات القديمة.</p>}
                {refreshedDay && !finalApprovalReady && refreshedDay.status !== 'approved' && <p className="mt-2">الاعتماد النهائي غير متاح حتى اكتمال فحص السياسة والأدلة. {diagnostic?.blocking_reason}</p>}
              </div>
              <fieldset className="mt-3" disabled={approving || evidenceBusy || refreshedDay?.status === 'approved'}>
                <legend className="text-xs font-black text-[var(--dawaa-theme-muted)]">نوع القرار</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {decisionsFor(selected).map((item) => (
                    <label key={item.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 text-xs font-black transition-colors ${reason === item.id ? 'border-[var(--dawaa-theme-primary)] bg-[var(--dawaa-theme-primary-soft)] text-[var(--dawaa-theme-heading)]' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]'}`}>
                      <input type="radio" name="attendance-case-decision" value={item.id} checked={reason === item.id} onChange={() => setReason(item.id)} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <button
                type="button"
                onClick={() => setShowDecisionEvidence((current) => !current)}
                className="btn-secondary mt-3 w-full justify-between !py-2 text-xs"
              >
                <span>{showDecisionEvidence ? 'إخفاء الأدلة والتشخيص' : 'عرض الأدلة والتشخيص'}</span>
                <span>{diagnosticLoading ? 'جارٍ التحليل…' : diagnostic ? `ثقة ${diagnostic.confidence}%` : ''}</span>
              </button>
            {showDecisionEvidence && <div className="mt-3 rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-black text-[var(--dawaa-status-info-text)]">التشخيص الذكي للحالة</div>
                  <div className="mt-1 text-sm font-black text-[var(--dawaa-theme-heading)]">
                    {diagnosticLoading ? 'جارٍ تحليل السبب...' : diagnosticError ? 'تعذر تحميل التشخيص' : diagnostic?.title || selected.issue_label}
                  </div>
                </div>
                {diagnostic && <span className="rounded-full border border-[var(--dawaa-status-info-border)] px-2 py-1 text-[10px] font-black text-[var(--dawaa-status-info-text)]">
                  ثقة {diagnostic.confidence}%
                </span>}
              </div>

              {diagnostic && <>
                <div className="mt-2 text-[10px] font-black tracking-wide text-[var(--dawaa-theme-muted)]">{diagnostic.root_cause_code}</div>
                <p className="mt-2 text-xs font-bold leading-5 text-[var(--dawaa-theme-heading)]">{diagnostic.diagnosis}</p>
                <div className="mt-2 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-2 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
                  <b>ما يمنع الإغلاق التلقائي:</b> {diagnostic.blocking_reason}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold text-[var(--dawaa-theme-muted)] sm:grid-cols-3">
                  <div>بصمات خام: <b className="text-[var(--dawaa-theme-heading)]">{Number(diagnostic.evidence.raw_events || 0)}</b></div>
                  <div>دخول: <b className="text-[var(--dawaa-theme-heading)]">{Number(diagnostic.evidence.check_in_count || 0)}</b></div>
                  <div>خروج: <b className="text-[var(--dawaa-theme-heading)]">{Number(diagnostic.evidence.check_out_count || 0)}</b></div>
                  <div>المزامنة: <b className="text-[var(--dawaa-theme-heading)]">{diagnostic.evidence.sync_complete_for_shift ? 'مكتملة' : 'غير مكتملة'}</b></div>
                  <div>الجدول: <b className="text-[var(--dawaa-theme-heading)]">{diagnostic.evidence.schedule_id ? 'موجود' : 'غير موجود'}</b></div>
                  <div>خروج مبكر: <b className="text-[var(--dawaa-theme-heading)]">{Number(diagnostic.evidence.early_leave_minutes || 0)} د</b></div>
                </div>
                <div className="mt-3">
                  <div className="text-xs font-black text-[var(--dawaa-theme-heading)]">الإجراءات المقترحة</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {diagnostic.suggested_actions.map((action) => {
                      const selectable = decisionsFor(selected).some((item) => item.id === action.id);
                      if (selectable) {
                        return <button key={action.id} type="button" onClick={() => setReason(action.id)} className="rounded-full border border-[var(--dawaa-theme-border)] px-3 py-1 text-[11px] font-black text-[var(--dawaa-theme-heading)] hover:border-[var(--dawaa-theme-primary)]">
                          {action.label}
                        </button>;
                      }
                      if (!embedded && (action.id === 'open_schedule' || action.id === 'review_schedule_versions' || action.id === 'fix_schedule_time')) {
                        return <a key={action.id} href="/schedule" className="rounded-full border border-[var(--dawaa-theme-border)] px-3 py-1 text-[11px] font-black text-[var(--dawaa-theme-heading)] hover:underline">
                          {action.label}
                        </a>;
                      }
                      return <span key={action.id} className="rounded-full border border-[var(--dawaa-theme-border)] px-3 py-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
                        {action.label}
                      </span>;
                    })}
                  </div>
                </div>
              </>}
            </div>}

            {reason === 'permission' && !approvedRequests.some((request) => request.request_kind === 'permission') && (
              <div className="mt-3 grid gap-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3 sm:grid-cols-2">
                <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
                  بداية الإذن
                  <input type="time" value={permissionStart} onChange={(event) => setPermissionStart(event.target.value)} className="input-dark mt-1 w-full" />
                </label>
                <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
                  نهاية الإذن
                  <input type="time" value={permissionEnd} onChange={(event) => setPermissionEnd(event.target.value)} className="input-dark mt-1 w-full" />
                </label>
                <p className="text-[11px] font-bold text-[var(--dawaa-theme-muted)] sm:col-span-2">
                  يلزم كتابة سبب الإذن في الملاحظة أدناه. سيتم فحص سياسة الأذونات والصلاحية قبل الاعتماد.
                </p>
              </div>
            )}
            {reason && !['annual_leave', 'sick_leave', 'exceptional_leave', 'approved_absence', 'shift_swap', 'forgot_in', 'forgot_out'].includes(reason) && (
              <label className="mt-3 block text-xs font-black text-[var(--dawaa-theme-muted)]">
                ساعات الاستحقاق للمرتب
                <input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min="0" max="18" step="0.01" className="input-dark mt-1 w-full" />
              </label>
            )}
            {(() => {
              const decision = decisionsFor(selected).find((item) => item.id === reason);
              const linked = decision?.requestKind && approvedRequests.find((request) => request.request_kind === decision.requestKind);
              return <>
                {decision && ['forgot_in', 'forgot_out'].includes(decision.id) && (
                  <div className="mt-3 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
                    {missingPunchLoading ? 'جارٍ تحميل سجل نسيان البصمة...' : missingPunchContext ? <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          دورة الحضور الحالية <b>{missingPunchContext.month_cycle}</b> · هذه الواقعة رقم <b>{missingPunchContext.occurrence_no}</b>
                        </div>
                        <span className="rounded-full border border-current px-2 py-1">
                          {missingPunchContext.penalty_eligible ? 'مؤهلة لخصم 50ج' : 'ضمن مرات السماح'}
                        </span>
                      </div>
                      <div className="mt-2 font-normal">
                        أول <b>{missingPunchContext.allowance_limit}</b> مرات في دورة 26→25 سماح.
                        {missingPunchContext.penalty_eligible
                          ? <> هذه الواقعة بعد استهلاك السماح، ويمكن تنفيذ خصم <b>50 جنيه</b>.</>
                          : <> المتبقي قبل بدء الخصم: <b>{Math.max(missingPunchContext.allowance_limit - missingPunchContext.occurrence_no, 0)}</b> مرة بعد تسجيل هذه الواقعة.</>}
                      </div>

                      <label className="mt-3 block font-black">
                        وقت البصمة اليدوية
                        <input
                          type="datetime-local"
                          value={manualPunchAt}
                          onChange={(e) => setManualPunchAt(e.target.value)}
                          className="input-dark mt-1 w-full"
                        />
                        <span className="mt-1 block font-normal">راجع الوقت من الدليل قبل الحفظ. سيتم تسجيلها كبصمة إدارية موثقة وإعادة حساب اليوم تلقائيًا.</span>
                      </label>

                      <label className={`mt-3 flex items-start gap-2 rounded-xl border p-3 ${missingPunchContext.penalty_eligible ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]'}`}>
                        <input
                          type="checkbox"
                          checked={applyMissingPunchPenalty}
                          disabled={!missingPunchContext.penalty_eligible || !missingPunchContext.can_apply_deduction || Boolean(missingPunchContext.deduction_transaction_id)}
                          onChange={(e) => setApplyMissingPunchPenalty(e.target.checked)}
                        />
                        <span>
                          <b>تنفيذ خصم 50 جنيه بسبب تكرار نسيان البصمة</b>
                          <span className="mt-1 block font-normal">
                            {missingPunchContext.deduction_transaction_id
                              ? 'الخصم مسجل بالفعل لهذه الواقعة ولن يتكرر.'
                              : !missingPunchContext.penalty_eligible
                                ? 'غير متاح حاليًا لأن الموظف ما زال داخل مرتين السماح.'
                                : missingPunchContext.can_apply_deduction
                                  ? 'متاح لأن الموظف تجاوز مرتين السماح ولديك صلاحية مالية للتنفيذ.'
                                  : 'الموظف تجاوز مرتين السماح، لكن تنفيذ الخصم يحتاج صلاحية مالية معتمدة.'}
                          </span>
                        </span>
                      </label>

                      {missingPunchHistory.length > 0 && (
                        <div className="mt-3">
                          <div className="font-black">آخر سجل نسيان بصمة للموظف</div>
                          <div className="mt-2 space-y-1">
                            {missingPunchHistory.slice(0, 5).map((item) => (
                              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--dawaa-theme-border)] px-2 py-1 font-normal">
                                <span>{item.attendance_date} · {item.missing_type === 'check_in' ? 'دخول' : 'خروج'} · الواقعة {item.occurrence_no}</span>
                                <span>{item.deduction_transaction_id ? 'خصم 50ج ✓' : item.penalty_eligible ? 'مؤهلة للخصم' : 'سماح'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </> : 'تعذر تحميل سجل نسيان البصمة لهذه الحالة.'}
                  </div>
                )}
                {decision?.id === 'annual_leave' && <div className="mt-3 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
                  {annualLeavePreviewLoading ? 'جارٍ حساب استهلاك الإجازة السنوية...' : annualLeavePreviewError ? 'تعذر تحميل ملخص الرصيد. أغلق القرار وافتحه مرة أخرى.' : annualLeavePreview ? (
                    annualLeavePreview.existing_request_status === 'approved'
                      ? <>هذا اليوم مسجل بالفعل كإجازة سنوية. المستخدم سنويًا: <b>{annualLeavePreview.year_used}</b> يوم · المستخدم هذا الشهر: <b>{annualLeavePreview.calendar_month_used}</b> يوم{annualLeavePreview.year_balance != null ? <> · المتبقي: <b>{annualLeavePreview.year_balance}</b> يوم</> : null}.</>
                      : <>قبل اعتماد هذا اليوم: المستخدم سنويًا <b>{annualLeavePreview.year_used}</b> يوم، وفي نفس الشهر <b>{annualLeavePreview.calendar_month_used}</b> يوم{annualLeavePreview.year_balance != null ? <>، والمتبقي الحالي <b>{annualLeavePreview.year_balance}</b> يوم</> : null}. بعد الاعتماد سيزيد الاستهلاك يومًا واحدًا. <span className="block mt-1 font-normal">دورة 26→25 الحالية: {annualLeavePreview.cycle_used} يوم مستخدم.</span></>
                  ) : 'جارٍ تجهيز ملخص الإجازة السنوية...'}
                </div>}
                {decision && ['sick_leave', 'exceptional_leave', 'approved_absence'].includes(decision.id) && (
                  <div className="mt-3 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
                    سيتم تسجيل هذا القرار واعتماده مباشرة في سجل الإجازات والغياب من نفس الشاشة، ثم تحديث حقيقة الحضور تلقائيًا. لا تحتاج لإنشاء الطلب مسبقًا.
                  </div>
                )}
                {decision?.id === 'shift_swap' && (selected.issue_group === 'absence' || selected.resolution_status === 'absence_review') && (
                  <div className="mt-3 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
                    {weeklyOffSwapLoading ? 'جارٍ تحميل يوم الراحة المعتمد لهذا الأسبوع...' : weeklyOffSwapError ? 'تعذر قراءة جدول الأسبوع. أغلق القرار وافتحه مرة أخرى.' : weeklyOffSwapPreview ? (
                      weeklyOffSwapPreview.off_day_candidates.length ? <>
                        <div>يوم الغياب الحالي <b>{selected.attendance_date}</b> سيتحول إلى يوم راحة.</div>
                        <label className="mt-2 block">
                          اختر يوم الراحة الأصلي الذي سيصبح يوم عمل
                          <select value={swapWithDate} onChange={(e) => setSwapWithDate(e.target.value)} className="input-dark mt-1 w-full">
                            <option value="">اختر يوم الراحة</option>
                            {weeklyOffSwapPreview.off_day_candidates.map((item) => (
                              <option key={item.date} value={item.date}>{item.day_name} — {item.date}</option>
                            ))}
                          </select>
                        </label>
                        {swapWithDate && <div className="mt-2 font-normal">سيتم نقل نفس مواعيد شيفت {selected.attendance_date} إلى يوم الراحة المختار، مع تسجيل Date Override لليومين وتحديث الحضور تلقائيًا.</div>}
                      </> : 'لم أجد يوم راحة معتمدًا آخر داخل نفس الأسبوع يمكن التبديل معه.'
                    ) : 'جارٍ تجهيز بيانات الأسبوع...'}
                  </div>
                )}
                {decision?.requestKind && !decision.schedule && !['annual_leave', 'sick_leave', 'exceptional_leave', 'approved_absence'].includes(decision.id) && !(decision.id === 'shift_swap' && (selected.issue_group === 'absence' || selected.resolution_status === 'absence_review')) && <div className="mt-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                  {requestsLoading ? 'جارٍ التحقق من الطلب المعتمد...' : requestsError ? 'تعذر التحقق من سجل الإجازات. أعد فتح القرار.' : linked ? `الطلب المعتمد المرتبط: ${linked.request_label || linked.request_kind} (${linked.id}). ${decision.requestKind === 'permission' ? 'راجع ساعات اليوم قبل الاعتماد.' : 'اضغط تحديث حقيقة الحضور من أعلى الصفحة بعد إغلاق القرار.'}` : <>لا يوجد طلب معتمد من هذا النوع لهذا اليوم. {embedded ? 'لا يمكن اعتماده بدون توثيق الطلب المطلوب.' : <a className="underline" href="/time-off">افتح الإجازات والغياب</a>} </>}
                </div>}
                {decision?.schedule && !(decision.id === 'shift_swap' && (selected.issue_group === 'absence' || selected.resolution_status === 'absence_review')) && (
                  <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
                    <p className="mb-2 font-bold">تعديل مواعيد يوم {selected.attendance_date} فقط. لن يتغير الجدول الأسبوعي أو أيام أخرى.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label>بداية الشيفت<input type="time" className="input-dark mt-1 block w-full" value={revisedShiftIn} onChange={(event) => setRevisedShiftIn(event.target.value)} /></label>
                      <label>نهاية الشيفت<input type="time" className="input-dark mt-1 block w-full" value={revisedShiftOut} onChange={(event) => setRevisedShiftOut(event.target.value)} /></label>
                    </div>
                    <p className="mt-2">اكتب سبب التعديل في الملاحظة. سيتم حفظ استثناء مؤرخ وإعادة فحص اليوم، دون اعتماد تلقائي إذا بقيت أدلة متعارضة.</p>
                  </div>
                )}
                {decision?.financial && <label className="mt-3 block text-xs font-black text-[var(--dawaa-theme-muted)]">معامل الخصم المقترح للمراجعة المالية
                  <select value={multiplier} onChange={(e) => setMultiplier(e.target.value)} className="input-dark mt-1 w-full"><option value="">اختر المعامل</option><option value="1">×1</option><option value="2">×2</option><option value="4">×4</option></select>
                  <span className="mt-1 block font-normal">الغياب: المعامل المقترح لليوم. التأخير: المعامل المقترح لمدة التأخير. اختيار «إجازة بخصم» هنا لا ينشئ طلب إجازة؛ سجّلها في الإجازات والغياب إن كانت إجازة رسمية. لا يُحسب مبلغ ولا يُسجل خصم تلقائيًا؛ راجعه في الجزاءات والرواتب.</span>
                </label>}
              </>;
            })()}
            <label className="mt-3 block text-xs font-black text-[var(--dawaa-theme-muted)]">
              ملاحظة القرار
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input-dark mt-1 w-full resize-none"
                placeholder={['custom', 'outside_work', 'absence_deduction', 'time_deduction', 'permission', 'schedule_error', 'shift_swap', 'forgot_in', 'forgot_out'].includes(reason) ? 'مطلوب: اكتب سبب القرار والدليل' : 'اختياري: تفاصيل إضافية توثق القرار'} />
            </label>
            <p className="mt-2 text-[10px] text-[var(--dawaa-theme-muted)]">الأدلة محفوظة في السجل ويمكن فتحها عند الحاجة بدون إطالة نافذة القرار.</p>
            </div>
            <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4">
              <button
                onClick={() => void approveSelected()}
                disabled={selected.queue_lane !== 'manager' || approving || evidenceBusy || refreshedDay?.status === 'approved' || (reason === 'annual_leave' && annualLeavePreviewLoading) || (reason === 'shift_swap' && (selected.issue_group === 'absence' || selected.resolution_status === 'absence_review') && weeklyOffSwapLoading)}
                className="btn-primary flex-1"
              >
                {selected.queue_lane !== 'manager'
                  ? 'مشكلة نظام — أصلح السبب أولًا'
                  : reason === 'annual_leave'
                  ? 'اعتماد الإجازة السنوية وتسجيلها'
                  : ['sick_leave', 'exceptional_leave', 'approved_absence'].includes(reason)
                    ? `اعتماد ${decisionsFor(selected).find((item) => item.id === reason)?.label || 'القرار'} وتسجيله`
                    : reason === 'shift_swap' && (selected.issue_group === 'absence' || selected.resolution_status === 'absence_review')
                      ? 'اعتماد تغيير يوم الراحة'
                      : ['shift_swap', 'schedule_error'].includes(reason)
                        ? 'حفظ شيفت هذا اليوم وإعادة مراجعة الحضور'
                        : ['forgot_in', 'forgot_out'].includes(reason)
                        ? applyMissingPunchPenalty ? 'تسجيل البصمة اليدوية + خصم 50ج' : 'تسجيل البصمة اليدوية'
                        : reason === 'permission' && !approvedRequests.some((request) => request.request_kind === 'permission')
                          ? 'حفظ الإذن وتحديث الأدلة'
                        : decisionsFor(selected).find((item) => item.id === reason)?.financial
                          ? 'اعتماد الحضور وتوثيق اقتراح الخصم'
                          : 'حفظ قرار الحضور'}
              </button>
              <button type="button" onClick={() => void approveRefreshedDay()}
                disabled={!finalApprovalReady || approving || !note.trim()}
                className="btn-primary flex-1">اعتماد القرار النهائي</button>
              <button disabled={approving || evidenceBusy} onClick={() => { setSelected(null); setNote(''); setReason(''); setMultiplier(''); setHours(''); setSwapWithDate(''); setWeeklyOffSwapPreview(null); setManualPunchAt(''); setApplyMissingPunchPenalty(false); setMissingPunchContext(null); setMissingPunchHistory([]); setShowDecisionEvidence(false); }} className="btn-secondary">{embedded ? 'إغلاق المراجعة' : 'إلغاء'}</button>
            </div>
          </div>
        </div>
      )}

      {profileStaffId && <EmployeeProfileDrawer staffId={profileStaffId} onClose={() => setProfileStaffId(null)} />}
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  icon: typeof Clock3;
  tone?: 'neutral' | 'warn' | 'info';
}) {
  const cls = tone === 'warn'
    ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]'
    : tone === 'info'
      ? 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)]'
      : 'border-[var(--dawaa-theme-border)] dawaa-surface';

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${cls}`}>
      <div className="flex items-center gap-2 text-[var(--dawaa-theme-muted)]"><Icon size={17} /><span className="text-xs font-black">{label}</span></div>
      <div className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}
