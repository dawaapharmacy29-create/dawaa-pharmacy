import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCw,
  Save,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import {
  fetchShiftPerformanceStats,
  loadShiftMembers,
  saveShiftPerformanceReview,
} from '@/lib/api/shiftPerformance';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { mergeStaffChoices, type StaffChoice } from '@/lib/staffFallback';
import {
  SHIFT_CONFIGS,
  SHIFT_ISSUES,
  buildShiftMembersWithPoints,
  normalizeBranchName,
  recommendedActionMode,
  shiftLabel,
  shouldProtectFromAutoDeduction,
  type NegligenceStatus,
  type ShiftActionMode,
  type ShiftMemberDraft,
  type ShiftReviewStatus,
  type ShiftType,
  type WorkloadPressure,
} from '@/lib/shiftPerformance';

const BRANCHES = ['فرع الشامي', 'فرع شكري'];
const PRESSURES: Array<{ value: WorkloadPressure; label: string }> = [
  { value: 'normal', label: 'عادي' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'عالي' },
  { value: 'very_high', label: 'عالي جدًا' },
];
const NEGLIGENCE: Array<{ value: NegligenceStatus; label: string }> = [
  { value: 'yes', label: 'نعم' },
  { value: 'no', label: 'لا' },
  { value: 'needs_review', label: 'يحتاج مراجعة' },
];
const ACTIONS: Array<{ value: ShiftActionMode; label: string }> = [
  { value: 'training_only', label: 'تدريب فقط بدون خصم' },
  { value: 'leader_only', label: 'خصم مسؤول الشيفت فقط' },
  { value: 'leader_and_team', label: 'خصم مسؤول الشيفت + باقي الفريق' },
  { value: 'custom', label: 'خصم مخصص يدوي' },
];
const SEVERITIES = [
  { value: 'low', label: 'بسيطة' },
  { value: 'medium', label: 'متوسطة' },
  { value: 'high', label: 'كبيرة' },
  { value: 'critical', label: 'حرجة' },
] as const;
const STATUSES: Array<{ value: ShiftReviewStatus; label: string }> = [
  { value: 'pending', label: 'pending - يحتاج اعتماد' },
  { value: 'approved', label: 'approved - معتمد' },
  { value: 'rejected', label: 'rejected - مرفوض' },
];

interface Staff extends StaffChoice {
  phone?: string | null;
}

interface ShiftReviewRow {
  id: string;
  review_date: string;
  branch_name: string;
  shift_type: string;
  issue_category: string;
  workload_pressure: WorkloadPressure;
  action_mode: ShiftActionMode;
  status: ShiftReviewStatus;
  total_points?: number | null;
  reviewed_by_name?: string | null;
  created_at?: string | null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function issueLabel(value: string) {
  return SHIFT_ISSUES.find((item) => item.value === value)?.label || value;
}

function memberKey(member: ShiftMemberDraft) {
  return `${member.staff_id}:${member.staff_name}`;
}

export default function ShiftPerformance() {
  const { user } = useAuth();
  const { data: staffRows = [] } = useSupabaseQuery<Staff>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    realtimeEnabled: false,
  });
  const staffChoices = useMemo(() => mergeStaffChoices(staffRows), [staffRows]);

  const [reviewDate, setReviewDate] = useState(todayISO());
  const [branch, setBranch] = useState('فرع الشامي');
  const [shiftType, setShiftType] = useState<ShiftType>('morning');
  const [shiftStart, setShiftStart] = useState(SHIFT_CONFIGS.morning.start);
  const [shiftEnd, setShiftEnd] = useState(SHIFT_CONFIGS.morning.end);
  const [issueCategory, setIssueCategory] = useState('warehouse_invoices');
  const [issueDescription, setIssueDescription] = useState('');
  const [workloadPressure, setWorkloadPressure] = useState<WorkloadPressure>('normal');
  const [workloadNotes, setWorkloadNotes] = useState('');
  const [negligence, setNegligence] = useState<NegligenceStatus>('needs_review');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [actionMode, setActionMode] = useState<ShiftActionMode>('training_only');
  const [status, setStatus] = useState<ShiftReviewStatus>('pending');
  const [evidence, setEvidence] = useState('');
  const [notes, setNotes] = useState('');
  const [members, setMembers] = useState<ShiftMemberDraft[]>([]);
  const [leaderId, setLeaderId] = useState('');
  const [memberMessage, setMemberMessage] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualStaffId, setManualStaffId] = useState('');
  const [reviews, setReviews] = useState<ShiftReviewRow[]>([]);
  const [reviewsError, setReviewsError] = useState<string | null>(null);

  useEffect(() => {
    const config = SHIFT_CONFIGS[shiftType];
    setShiftStart(config.start);
    setShiftEnd(config.end);
  }, [shiftType]);

  useEffect(() => {
    setActionMode(recommendedActionMode(workloadPressure, negligence));
  }, [workloadPressure, negligence]);

  useEffect(() => {
    setMembers((current) =>
      buildShiftMembersWithPoints(current, leaderId, actionMode, workloadPressure, negligence)
    );
  }, [leaderId, actionMode, workloadPressure, negligence]);

  async function loadStats() {
    const result = await fetchShiftPerformanceStats();
    setReviews(result.reviews as ShiftReviewRow[]);
    setReviewsError(result.error);
  }

  useEffect(() => {
    loadStats();
  }, []);

  async function handleLoadMembers() {
    setLoadingMembers(true);
    try {
      const result = await loadShiftMembers({
        date: reviewDate,
        branch,
        shiftType,
        shiftStart,
        shiftEnd,
      });
      setMemberMessage(result.message);
      setMembers(
        buildShiftMembersWithPoints(
          result.members,
          leaderId,
          actionMode,
          workloadPressure,
          negligence
        )
      );
      if (!result.members.length) {
        toast.info('لم يتم العثور على أعضاء تلقائيًا، اخترهم يدويًا من القائمة.');
      } else {
        toast.success(result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر تحديد أعضاء الشيفت.';
      setMemberMessage(message);
      toast.error(message);
    } finally {
      setLoadingMembers(false);
    }
  }

  function addManualMember() {
    const staff = staffChoices.find((item) => item.id === manualStaffId);
    if (!staff) return;
    if (members.some((member) => member.staff_id === staff.id)) {
      toast.info('الموظف موجود بالفعل في قائمة الشيفت.');
      return;
    }
    const next: ShiftMemberDraft = {
      staff_id: staff.id,
      staff_name: staff.name,
      staff_role: staff.role,
      branch: staff.branch,
      shift_start: shiftStart,
      shift_end: shiftEnd,
      was_present: true,
      has_permission: false,
      is_shift_leader: false,
      base_points: 0,
      repeat_count: 0,
      multiplier: 1,
      assigned_points: 0,
      notes: null,
    };
    setMembers((current) =>
      buildShiftMembersWithPoints(
        [...current, next],
        leaderId,
        actionMode,
        workloadPressure,
        negligence
      )
    );
    setManualStaffId('');
  }

  function updateMember(id: string, patch: Partial<ShiftMemberDraft>) {
    setMembers((current) =>
      current.map((member) => (member.staff_id === id ? { ...member, ...patch } : member))
    );
  }

  async function handleSave() {
    if (!issueDescription.trim()) {
      toast.error('اكتب وصف المشكلة قبل الحفظ.');
      return;
    }
    if (!members.length) {
      toast.error('اختر أعضاء الشيفت أولًا.');
      return;
    }
    if (actionMode !== 'training_only' && !leaderId) {
      toast.error('حدد مسؤول الشيفت قبل تطبيق أي خصم.');
      return;
    }

    setSaving(true);
    try {
      const finalMembers = buildShiftMembersWithPoints(
        members,
        leaderId,
        actionMode,
        workloadPressure,
        negligence
      );
      const result = await saveShiftPerformanceReview({
        review_date: reviewDate,
        branch_name: normalizeBranchName(branch),
        shift_type: shiftType,
        shift_start: shiftStart,
        shift_end: shiftEnd,
        issue_category: issueCategory,
        issue_description: issueDescription.trim(),
        workload_pressure: workloadPressure,
        workload_pressure_notes: workloadNotes.trim() || null,
        negligence_suspected: negligence,
        severity,
        action_mode: actionMode,
        status,
        reviewed_by: user?.id ?? null,
        reviewed_by_name: user?.name || 'المدير',
        approved_by: status === 'approved' ? (user?.id ?? null) : null,
        approved_by_name: status === 'approved' ? user?.name || 'المدير' : null,
        evidence: evidence.trim() || null,
        notes: notes.trim() || null,
        members: finalMembers,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(
        status === 'approved'
          ? 'تم حفظ تقييم الشيفت وتحديث سجلات النقاط.'
          : 'تم حفظ تقييم الشيفت كحالة تحتاج اعتماد.'
      );
      setIssueDescription('');
      setEvidence('');
      setNotes('');
      setMembers([]);
      setLeaderId('');
      await loadStats();
    } finally {
      setSaving(false);
    }
  }

  const cycle = getCurrentCycle();
  const cycleReviews = useMemo(() => {
    const start = cycle.start.getTime();
    const end = cycle.end.getTime();
    return reviews.filter((review) => {
      const time = new Date(`${review.review_date || review.created_at}T12:00:00`).getTime();
      return time >= start && time <= end;
    });
  }, [reviews, cycle.start, cycle.end]);

  const reviewStats = useMemo(() => {
    const byShift = new Map<string, number>();
    const byIssue = new Map<string, number>();
    let totalPoints = 0;
    let protectedCases = 0;

    for (const review of cycleReviews) {
      byShift.set(review.shift_type, (byShift.get(review.shift_type) || 0) + 1);
      byIssue.set(review.issue_category, (byIssue.get(review.issue_category) || 0) + 1);
      totalPoints += Number(review.total_points || 0);
      if (review.workload_pressure === 'high' || review.workload_pressure === 'very_high')
        protectedCases++;
    }

    const topShift = [...byShift.entries()].sort((a, b) => b[1] - a[1])[0];
    const topIssue = [...byIssue.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      count: cycleReviews.length,
      topShift: topShift ? shiftLabel(topShift[0]) : 'لا يوجد',
      topIssue: topIssue ? issueLabel(topIssue[0]) : 'لا يوجد',
      totalPoints,
      protectedCases,
    };
  }, [cycleReviews]);

  const selectedMembers = members.filter((member) => member.was_present);
  const totalSuggestedPoints = selectedMembers.reduce(
    (sum, member) => sum + Math.abs(Number(member.assigned_points || 0)),
    0
  );
  const protectedByPressure = shouldProtectFromAutoDeduction(workloadPressure);

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center text-teal-400">
          <ClipboardList size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">تقييم أداء الشيفتات</h1>
          <p className="text-slate-400 text-sm mt-1">
            تقييم الشيفتات هدفه تحسين توزيع المهام وتسليم الشغل بين الفريق، مع مراعاة ضغط العمل
            الحقيقي قبل تطبيق أي خصم.
          </p>
        </div>
      </div>

      {reviewsError && (
        <div className="stat-card border border-amber-500/25 text-amber-100 text-sm">
          جدول تقييم الشيفتات غير جاهز أو يحتاج migration. ستجد ملف SQL جاهز ضمن التقرير النهائي.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Metric title="تقييمات الدورة" value={reviewStats.count} />
        <Metric title="أكثر شيفت عليه ملاحظات" value={reviewStats.topShift} />
        <Metric title="أكثر سبب تكرارًا" value={reviewStats.topIssue} />
        <Metric title="إجمالي خصومات الشيفتات" value={reviewStats.totalPoints} danger />
        <Metric title="ضغط شغل بدون خصم" value={reviewStats.protectedCases} />
      </div>

      <div className="stat-card border border-teal-500/15">
        <div className="section-title mb-4">بيانات التقييم</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label className="space-y-1 text-sm text-slate-300">
            التاريخ
            <input
              type="date"
              value={reviewDate}
              onChange={(event) => setReviewDate(event.target.value)}
              className="input-dark"
            />
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            الفرع
            <select
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              className="input-dark"
            >
              {BRANCHES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            نوع الشيفت
            <select
              value={shiftType}
              onChange={(event) => setShiftType(event.target.value as ShiftType)}
              className="input-dark"
            >
              {Object.values(SHIFT_CONFIGS).map((item) => (
                <option key={item.type} value={item.type}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            الحالة
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as ShiftReviewStatus)}
              className="input-dark"
            >
              {STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            بداية الشيفت
            <input
              type="time"
              value={shiftStart}
              onChange={(event) => setShiftStart(event.target.value)}
              className="input-dark"
            />
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            نهاية الشيفت
            <input
              type="time"
              value={shiftEnd}
              onChange={(event) => setShiftEnd(event.target.value)}
              className="input-dark"
            />
          </label>
          <label className="space-y-1 text-sm text-slate-300 md:col-span-2">
            سبب التقييم
            <select
              value={issueCategory}
              onChange={(event) => setIssueCategory(event.target.value)}
              className="input-dark"
            >
              {SHIFT_ISSUES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block mt-4 space-y-1 text-sm text-slate-300">
          وصف المشكلة
          <textarea
            value={issueDescription}
            onChange={(event) => setIssueDescription(event.target.value)}
            rows={3}
            className="input-dark resize-none"
            placeholder="مثال: طلبيات مخزن وصلت ولم يتم إدخال الفواتير أو ترتيب الأصناف قبل تسليم الشيفت."
          />
        </label>
      </div>

      <div className="stat-card border border-amber-500/15">
        <div className="section-title mb-4">مراعاة ضغط الشغل</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label className="space-y-1 text-sm text-slate-300">
            مستوى الضغط
            <select
              value={workloadPressure}
              onChange={(event) => setWorkloadPressure(event.target.value as WorkloadPressure)}
              className="input-dark"
            >
              {PRESSURES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            هل المشكلة بسبب تكاسل أو إهمال؟
            <select
              value={negligence}
              onChange={(event) => setNegligence(event.target.value as NegligenceStatus)}
              className="input-dark"
            >
              {NEGLIGENCE.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            مستوى المشكلة
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value as typeof severity)}
              className="input-dark"
            >
              {SEVERITIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            نوع الإجراء
            <select
              value={actionMode}
              onChange={(event) => setActionMode(event.target.value as ShiftActionMode)}
              className="input-dark"
            >
              {ACTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {protectedByPressure && (
          <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-amber-100 text-sm flex gap-3">
            <AlertTriangle size={20} className="mt-0.5 flex-shrink-0" />
            <div>
              يوجد ضغط عمل مرتفع، يفضل مراجعة الموقف قبل تطبيق الخصم. الإجراء الافتراضي هنا تدريب
              فقط أو انتظار اعتماد المدير العام.
            </div>
          </div>
        )}

        <label className="block mt-4 space-y-1 text-sm text-slate-300">
          ملاحظات ضغط الشغل
          <textarea
            value={workloadNotes}
            onChange={(event) => setWorkloadNotes(event.target.value)}
            rows={2}
            className="input-dark resize-none"
            placeholder="اذكر سبب اعتبار الشغل مضغوطًا: عدد فواتير كبير، نقص أفراد، تراكم توصيل، إلخ."
          />
        </label>
      </div>

      <div className="stat-card">
        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
          <div className="section-title flex-1">أعضاء الشيفت ومسؤول الشيفت</div>
          <button
            onClick={handleLoadMembers}
            disabled={loadingMembers}
            className="btn-secondary flex items-center justify-center gap-2"
          >
            {loadingMembers ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            تحديد أعضاء الشيفت
          </button>
        </div>

        {memberMessage && (
          <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-sm text-blue-100">
            {memberMessage}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-3 mb-4">
          <select
            value={manualStaffId}
            onChange={(event) => setManualStaffId(event.target.value)}
            className="input-dark flex-1"
          >
            <option value="">إضافة موظف يدويًا عند نقص بيانات الجدول</option>
            {staffChoices
              .filter((staff) => normalizeBranchName(staff.branch) === normalizeBranchName(branch))
              .map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name} - {staff.role}
                </option>
              ))}
          </select>
          <button
            onClick={addManualMember}
            type="button"
            className="btn-primary flex items-center justify-center gap-2"
          >
            <UserPlus size={16} />
            إضافة
          </button>
        </div>

        {members.length === 0 ? (
          <div className="text-center text-slate-400 py-10">
            اختر التاريخ والفرع والشيفت ثم اضغط تحديد أعضاء الشيفت.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ضمن الشيفت</th>
                  <th>الموظف</th>
                  <th>الدور</th>
                  <th>وقت الشيفت</th>
                  <th>حضور/إذن</th>
                  <th>مسؤول الشيفت</th>
                  <th>الخصم المقترح</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={memberKey(member)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={member.was_present}
                        onChange={(event) =>
                          updateMember(member.staff_id, {
                            was_present: event.target.checked,
                          })
                        }
                      />
                    </td>
                    <td className="font-bold text-white">{member.staff_name}</td>
                    <td>{member.staff_role}</td>
                    <td>
                      <span className="num">
                        {member.shift_start || shiftStart} - {member.shift_end || shiftEnd}
                      </span>
                    </td>
                    <td>
                      {member.has_permission ? (
                        <span className="badge-warning">لديه إذن جزئي</span>
                      ) : member.was_present ? (
                        <span className="badge-success">موجود</span>
                      ) : (
                        <span className="badge-danger">غير موجود</span>
                      )}
                    </td>
                    <td>
                      <input
                        type="radio"
                        name="shiftLeader"
                        checked={leaderId === member.staff_id}
                        onChange={() => setLeaderId(member.staff_id)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={member.assigned_points}
                        disabled={actionMode !== 'custom'}
                        onChange={(event) =>
                          updateMember(member.staff_id, {
                            assigned_points: Number(event.target.value),
                            base_points: Number(event.target.value),
                          })
                        }
                        className="input-dark w-24"
                      />
                    </td>
                    <td>
                      <input
                        value={member.notes || ''}
                        onChange={(event) =>
                          updateMember(member.staff_id, {
                            notes: event.target.value,
                          })
                        }
                        className="input-dark min-w-44"
                        placeholder="ملاحظة اختيارية"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="stat-card border border-teal-500/20">
        <div className="section-title mb-4">ملخص قبل الحفظ</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <Metric title="أعضاء الشيفت" value={selectedMembers.length} />
          <Metric
            title="مسؤول الشيفت"
            value={members.find((member) => member.staff_id === leaderId)?.staff_name || 'غير محدد'}
          />
          <Metric title="إجمالي الخصم المقترح" value={totalSuggestedPoints} danger />
          <Metric
            title="الإجراء"
            value={ACTIONS.find((item) => item.value === actionMode)?.label || actionMode}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-1 text-sm text-slate-300">
            ملاحظات المدير
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              className="input-dark resize-none"
            />
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            دليل أو رابط صورة إن وجد
            <textarea
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              rows={3}
              className="input-dark resize-none"
              placeholder="رابط صورة، ملاحظة، أو تفاصيل إثبات."
            />
          </label>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary w-full mt-5 flex items-center justify-center gap-2 text-base py-3"
        >
          {saving ? (
            <Loader2 size={18} className="animate-spin" />
          ) : status === 'approved' ? (
            <CheckCircle2 size={18} />
          ) : (
            <Save size={18} />
          )}
          حفظ تقييم الشيفت
        </button>
      </div>

      <div className="stat-card">
        <div className="section-title mb-4">آخر تقييمات الشيفتات</div>
        {cycleReviews.length === 0 ? (
          <div className="text-center text-slate-400 py-8">
            لا توجد تقييمات شيفتات في الدورة الحالية.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الفرع</th>
                  <th>الشيفت</th>
                  <th>السبب</th>
                  <th>ضغط الشغل</th>
                  <th>النقاط</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {cycleReviews.slice(0, 10).map((review) => (
                  <tr key={review.id}>
                    <td>{review.review_date}</td>
                    <td>{review.branch_name}</td>
                    <td>{shiftLabel(review.shift_type)}</td>
                    <td>{issueLabel(review.issue_category)}</td>
                    <td>
                      {PRESSURES.find((item) => item.value === review.workload_pressure)?.label ||
                        review.workload_pressure}
                    </td>
                    <td className="text-red-300 font-bold">{Number(review.total_points || 0)}</td>
                    <td>
                      {review.status === 'approved' ? (
                        <span className="badge-success">معتمد</span>
                      ) : review.status === 'rejected' ? (
                        <span className="badge-danger">مرفوض</span>
                      ) : (
                        <span className="badge-warning">يحتاج اعتماد</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  title,
  value,
  danger,
}: {
  title: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <div className="stat-card text-center">
      <div className={`text-2xl font-bold ${danger ? 'text-red-400' : 'text-teal-400'}`}>
        {value}
      </div>
      <div className="text-slate-400 text-sm mt-1">{title}</div>
    </div>
  );
}
