import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import {
  approveAttendanceResolution,
  getAttendanceCaseDiagnosticV1,
  getAttendanceDiagnosticSummaryV1,
  getMissingPunchContextV1,
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
import EmployeeProfileDrawer from '@/components/attendance/EmployeeProfileDrawer';
import AttendanceCorrectionReviewPanel from '@/components/attendance/AttendanceCorrectionReviewPanel';
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
import { useStaffDirectory } from '@/hooks/useStaffDirectory';

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
  { id: 'shift_swap', label: 'تغيير يوم الراحة هذا الأسبوع', requestKind: 'shift_swap', schedule: true },
  { id: 'absence_deduction', label: 'غياب أو إجازة بخصم — اقتراح للمراجعة المالية', financial: true },
  { id: 'outside_work', label: 'مأمورية أو عمل خارج الفرع مثبت' },
  { id: 'custom', label: 'سبب آخر (اكتب التفاصيل)' },
];
const PUNCH_DECISIONS: Decision[] = [
  { id: 'forgot_in', label: 'نسيان بصمة الدخول بعد التحقق' },
  { id: 'forgot_out', label: 'نسيان بصمة الخروج بعد التحقق' },
  { id: 'device_fault', label: 'عطل جهاز البصمة مثبت' },
  { id: 'cross_branch', label: 'عمل بفرع آخر مثبت' },
  { id: 'custom', label: 'سبب آخر (اكتب التفاصيل)' },
];
const TIME_DECISIONS: Decision[] = [
  { id: 'permission', label: 'تأخير أو انصراف مبكر بإذن', requestKind: 'permission' },
  { id: 'time_deduction', label: 'تأخير أو انصراف مبكر مع إحالة الخصم للمراجعة المالية', financial: true },
  { id: 'shift_swap', label: 'تغيير موعد الشيفت المعتمد', requestKind: 'shift_swap', schedule: true },
  { id: 'schedule_error', label: 'تصحيح جدول العمل', schedule: true },
  { id: 'custom', label: 'سبب آخر (اكتب التفاصيل)' },
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

function decisionsFor(row: AttendanceExceptionRow): Decision[] {
  if (row.issue_group === 'absence' || row.resolution_status === 'absence_review') return ABSENCE_DECISIONS;
  if (row.resolution_status === 'missing_checkin') return PUNCH_DECISIONS.filter((item) => item.id !== 'forgot_out');
  if (row.resolution_status === 'missing_checkout') return PUNCH_DECISIONS.filter((item) => item.id !== 'forgot_in');
  if (row.issue_group === 'missing_punch' || row.resolution_status?.startsWith('missing_')) return PUNCH_DECISIONS;
  return TIME_DECISIONS;
}

export default function AttendanceResolutionCenter({
  defaultBranch = 'الكل',
  initialDate = null,
  initialTriage = 'manager',
}: {
  defaultBranch?: string;
  initialDate?: string | null;
  initialTriage?: 'all' | 'manager' | 'system';
}) {
  const [start, setStart] = useState(() => initialDate || cairoDate(-7));
  const [end, setEnd] = useState(() => initialDate || cairoDate());
  const [branch, setBranch] = useState(defaultBranch || 'الكل');
  const [lane, setLane] = useState<'all' | AttendanceExceptionLane>(initialTriage);
  const [rows, setRows] = useState<AttendanceExceptionRow[]>([]);
  const [diagnosticSummary, setDiagnosticSummary] = useState<AttendanceDiagnosticSummaryV1 | null>(null);
  const [categoryTab, setCategoryTab] = useState<'all' | 'absence' | 'early_leave' | 'missing_punch' | 'system'>('all');
  const [missingPunchTab, setMissingPunchTab] = useState<'all' | 'check_in' | 'check_out'>('all');
  const [showFormer, setShowFormer] = useState(false);
  const { data: staffDirectory = [], isLoading: directoryLoading, isError: directoryError } = useStaffDirectory();
  const [loading, setLoading] = useState(false);
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
  const [approving, setApproving] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [bulkDecision, setBulkDecision] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [bulkMultiplier, setBulkMultiplier] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    setLane(initialTriage);
    if (!initialDate) return;
    setStart(initialDate);
    setEnd(initialDate);
  }, [initialDate, initialTriage]);

  const load = useCallback(async () => {
    setLoading(true);
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
      setRows(queue);
      setDiagnosticSummary(summary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل صندوق مراجعة الحضور');
    } finally {
      setLoading(false);
    }
  }, [branch, end, lane, start]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
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
  }, [selected]);

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
  }, [selected]);

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
  }, [selected]);

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

  const formerIds = useMemo(() => new Set(staffDirectory
    .filter((person) => person.source === 'staff' && person.id && !person.active)
    .map((person) => person.id)), [staffDirectory]);
  const formerRows = rows.filter((row) => formerIds.has(row.staff_id));
  const baseRows = showFormer ? rows : rows.filter((row) => !formerIds.has(row.staff_id));
  const tabCounts = useMemo(() => ({
    all: baseRows.length,
    absence: baseRows.filter((row) => row.issue_group === 'absence' || row.resolution_status === 'absence_review').length,
    earlyLeave: baseRows.filter((row) => row.issue_group === 'early_leave' || row.resolution_status === 'early_leave_review').length,
    missingPunch: baseRows.filter((row) => row.issue_group === 'missing_punch' || row.resolution_status?.startsWith('missing_')).length,
    missingCheckIn: baseRows.filter((row) => row.resolution_status === 'missing_checkin').length,
    missingCheckOut: baseRows.filter((row) => row.resolution_status === 'missing_checkout').length,
    system: baseRows.filter((row) => row.queue_lane === 'system').length,
  }), [baseRows]);
  const visibleRows = baseRows.filter((row) => lane === 'all' || row.queue_lane === lane);
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

  async function approveSelected() {
    if (!selected) return;
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

      const manualIso = new Date(manualPunchAt).toISOString();
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
        setSelected(null);
        setNote('');
        setReason('');
        setMultiplier('');
        setHours('');
        setManualPunchAt('');
        setApplyMissingPunchPenalty(false);
        setMissingPunchContext(null);
        setMissingPunchHistory([]);
        await load();
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

    const linkedRequest = decision.requestKind && approvedRequests.find((request) => request.request_kind === decision.requestKind);
    if (decision.requestKind && (requestsLoading || requestsError || !linkedRequest)) {
      toast.error('سجّل الطلب واعتمده في صفحة الإجازات والغياب أولًا، ثم راجع اليوم مجددًا.');
      return;
    }
    if (decision.requestKind && decision.requestKind !== 'permission') {
      toast.warning('الطلب معتمد. حدّث حقيقة الحضور أولًا ليُحتسب بنوع الإجازة الصحيح بدل اعتماد صفر ساعات من هذه الشاشة.');
      return;
    }
    if (decision.schedule) {
      toast.warning('راجع تعديل الجدول أو يوم الراحة وأعد تحديث حقيقة الحضور قبل اعتماد اليوم.');
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

  const currentLaneMeta = lane === 'system' ? laneMeta('system') : laneMeta('manager');

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1">
            <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Exception Inbox V2</div>
            <h2 className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">صندوق مراجعة الحضور</h2>
            <p className="mt-1 text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
              الموظف السليم لا يظهر هنا. نفصل قرار المدير عن مشكلة النظام، ومشكلة النظام لا تتحول تلقائيًا إلى مخالفة أو خصم.
            </p>
          </div>

          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
            من
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-dark mt-1 block" />
          </label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
            إلى
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-dark mt-1 block" />
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
          <button onClick={() => void runMaterialization()} disabled={materializing} className="btn-primary">
            <ShieldCheck size={16} className={materializing ? 'animate-pulse' : ''} /> تحديث حقيقة الحضور
          </button>
        </div>

        <input value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark mt-3 max-w-xs" placeholder="الفرع أو الكل" />

        <label className="mt-3 flex items-center gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">
          <input type="checkbox" checked={showFormer} onChange={(e) => setShowFormer(e.target.checked)} />
          إظهار الموظفين السابقين ({formerRows.length} يوم معلّق في النطاق الحالي)
        </label>
        {directoryError && <p className="mt-2 text-xs text-[var(--dawaa-status-warning-text)]">تعذر التحقق من حالة الموظفين؛ تظهر كل الحالات حتى يُعاد تحميل دليل الموظفين.</p>}
        {formerRows.length > 0 && !showFormer && <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">أيام الموظفين السابقين محفوظة للمراجعة التاريخية، ولا تُلغى من جاهزية الرواتب بمجرد إخفائها هنا.</p>}

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
              placeholder="اختياري — إجباري للسبب الآخر أو العمل خارج الفرع"
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

      <section className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
        <table className="min-w-[1050px] w-full text-sm">
          <thead className="border-b border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]">
            <tr>
              <th className="w-12 p-3 text-center">اختيار</th>
              <th className="p-3 text-right">الموظف</th>
              <th className="p-3 text-right">اليوم</th>
              <th className="p-3 text-right">نوع الحالة</th>
              <th className="p-3 text-right">المسار</th>
              <th className="p-3 text-right">الدليل</th>
              <th className="p-3 text-right">دخول / خروج</th>
              <th className="p-3 text-right">ساعات مرشحة</th>
              <th className="p-3 text-right">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {!directoryLoading && visibleRows.map((row) => {
              const meta = laneMeta(row.queue_lane);
              return (
                <tr key={row.id} className={`border-b border-[var(--dawaa-theme-border)]/60 last:border-0 ${selectedRowIds.has(row.id) ? 'bg-[var(--dawaa-theme-primary-soft)]/30' : ''}`}>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedRowIds.has(row.id)}
                      disabled={row.queue_lane !== 'manager' || bulkBusy}
                      aria-label={`اختيار حالة ${row.staff_name} بتاريخ ${row.attendance_date}`}
                      onChange={(event) => {
                        setSelectedRowIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <button onClick={() => setProfileStaffId(row.staff_id)} className="text-right font-black text-[var(--dawaa-theme-heading)] hover:underline hover:text-[var(--dawaa-theme-primary-strong)]">
                      {row.staff_name}
                    </button>
                    <div className="text-xs text-[var(--dawaa-theme-muted)]">{row.branch || '-'}</div>
                    {formerIds.has(row.staff_id) && <div className="text-xs text-[var(--dawaa-status-warning-text)]">موظف سابق — راجع تاريخ آخر يوم عمل</div>}
                  </td>
                  <td className="p-3">
                    <div className="font-black">{row.attendance_date}</div>
                    <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{arabicWeekday(row.attendance_date)}</div>
                  </td>
                  <td className="p-3">
                    <div className="font-black text-[var(--dawaa-theme-heading)]">{row.issue_label}</div>
                    <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.issue_group}</div>
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black ${meta.className}`}>{meta.label}</span>
                    {row.queue_lane === 'system' && <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-status-info-text)]">لا إجراء على الموظف</div>}
                  </td>
                  <td className="p-3">
                    <div className="font-black">{row.raw_events.toLocaleString('ar-EG')} بصمة خام</div>
                    <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الدليل محفوظ ولا يتم تعديله</div>
                  </td>
                  <td className="p-3 text-xs">
                    <div>{fmt(row.first_in)}</div>
                    <div>{fmt(row.last_out)}</div>
                  </td>
                  <td className="p-3 font-black">{row.candidate_hours == null ? '-' : row.candidate_hours.toFixed(2)}</td>
                  <td className="p-3">
                    {row.queue_lane === 'manager'
                      ? <button onClick={() => { setSelected(row); setHours(row.candidate_hours == null ? '' : String(row.candidate_hours)); setNote(''); setReason(''); setMultiplier(''); }} className="btn-secondary text-xs">اتخاذ قرار</button>
                      : <button onClick={() => { setSelected(row); setHours(row.candidate_hours == null ? '' : String(row.candidate_hours)); setNote(''); setReason(''); setMultiplier(''); }} className="btn-secondary text-xs">تشخيص وإصلاح</button>}
                  </td>
                </tr>
              );
            })}
            {!displayRows.length && !loading && !directoryLoading && (
              <tr>
                <td colSpan={9} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">
                  لا توجد حالات في هذا المسار خلال الفترة المحددة.
                </td>
              </tr>
            )}
            {directoryLoading && <tr><td colSpan={9} className="p-8 text-center">جارٍ التحقق من حالة الموظفين...</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4 text-xs font-bold text-[var(--dawaa-status-info-text)]">
        الحضور يثبت الحقيقة التشغيلية أولًا. الخصومات العامة تمر من مسار الرواتب/الجزاءات؛ والاستثناء الوحيد هنا هو خصم نسيان البصمة الثابت 50ج بعد تجاوز مرتين السماح، لأنه مرتبط مباشرة بسجل الواقعة وممنوع تكراره لنفس البصمة.
      </section>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-2xl">
            <h3 className="text-lg font-black text-[var(--dawaa-theme-heading)]">قرار حضور — {selected.staff_name}</h3>
            <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">
              {selected.issue_label} · {selected.attendance_date}
            </p>
            <div className="mt-3 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
              هذا اعتماد لحقيقة الحضور، وليس قرار خصم أو جزاء مالي.
            </div>
            <div className="mt-4 rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4">
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
                      if (action.id === 'open_schedule' || action.id === 'review_schedule_versions' || action.id === 'fix_schedule_time') {
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
            </div>

            <label className="mt-4 block text-xs font-black text-[var(--dawaa-theme-muted)]">
              ساعات الاستحقاق للمرتب
              <input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min="0" max="18" step="0.01" className="input-dark mt-1 w-full" />
            </label>
            <label className="mt-3 block text-xs font-black text-[var(--dawaa-theme-muted)]">
              نوع القرار
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="input-dark mt-1 w-full">
                <option value="">اختر بعد مراجعة الدليل</option>
                {decisionsFor(selected).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
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
                {decision?.requestKind && !['annual_leave', 'sick_leave', 'exceptional_leave', 'approved_absence'].includes(decision.id) && !(decision.id === 'shift_swap' && (selected.issue_group === 'absence' || selected.resolution_status === 'absence_review')) && <div className="mt-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                  {requestsLoading ? 'جارٍ التحقق من الطلب المعتمد...' : requestsError ? 'تعذر التحقق من سجل الإجازات. أعد فتح القرار.' : linked ? `الطلب المعتمد المرتبط: ${linked.request_label || linked.request_kind} (${linked.id}). ${decision.requestKind === 'permission' ? 'راجع ساعات اليوم قبل الاعتماد.' : 'اضغط تحديث حقيقة الحضور من أعلى الصفحة بعد إغلاق القرار.'}` : <>لا يوجد طلب معتمد من هذا النوع لهذا اليوم. <a className="underline" href="/time-off">افتح الإجازات والغياب</a> لتسجيله واعتماده أولًا.</>}
                </div>}
                {decision?.schedule && !(decision.id === 'shift_swap' && (selected.issue_group === 'absence' || selected.resolution_status === 'absence_review')) && <p className="mt-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">راجع تغيير الراحة أو الشيفت في الجدول ثم حدّث حقيقة الحضور؛ لا يُعتمد من هذه الشاشة مباشرة.</p>}
                {decision?.financial && <label className="mt-3 block text-xs font-black text-[var(--dawaa-theme-muted)]">معامل الخصم المقترح للمراجعة المالية
                  <select value={multiplier} onChange={(e) => setMultiplier(e.target.value)} className="input-dark mt-1 w-full"><option value="">اختر المعامل</option><option value="1">×1</option><option value="2">×2</option><option value="4">×4</option></select>
                  <span className="mt-1 block font-normal">الغياب: المعامل المقترح لليوم. التأخير: المعامل المقترح لمدة التأخير. اختيار «إجازة بخصم» هنا لا ينشئ طلب إجازة؛ سجّلها في الإجازات والغياب إن كانت إجازة رسمية. لا يُحسب مبلغ ولا يُسجل خصم تلقائيًا؛ راجعه في الجزاءات والرواتب.</span>
                </label>}
              </>;
            })()}
            <label className="mt-3 block text-xs font-black text-[var(--dawaa-theme-muted)]">
              تفاصيل التحقق أو سبب آخر
              <textarea value={note} onChange={(e) => setNote(e.target.value)} className="input-dark mt-1 min-h-24 w-full" placeholder="اكتب تفاصيل التحقق أو سببًا غير موجود في القائمة..." />
            </label>
            <p className="mt-2 text-xs text-[var(--dawaa-theme-muted)]">اختر السبب بعد التحقق من الدليل؛ الساعات تُراجع منفصلة ولا تُحدد تلقائيًا من السبب.</p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void approveSelected()}
                disabled={selected.queue_lane !== 'manager' || approving || (reason === 'annual_leave' && annualLeavePreviewLoading) || (reason === 'shift_swap' && (selected.issue_group === 'absence' || selected.resolution_status === 'absence_review') && weeklyOffSwapLoading)}
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
                      : ['forgot_in', 'forgot_out'].includes(reason)
                        ? applyMissingPunchPenalty ? 'تسجيل البصمة اليدوية + خصم 50ج' : 'تسجيل البصمة اليدوية'
                        : decisionsFor(selected).find((item) => item.id === reason)?.financial
                          ? 'اعتماد الحضور وتوثيق اقتراح الخصم'
                          : 'اعتماد موثق'}
              </button>
              <button onClick={() => { setSelected(null); setNote(''); setReason(''); setMultiplier(''); setHours(''); setSwapWithDate(''); setWeeklyOffSwapPreview(null); setManualPunchAt(''); setApplyMissingPunchPenalty(false); setMissingPunchContext(null); setMissingPunchHistory([]); }} className="btn-secondary">إلغاء</button>
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
