import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CalendarDays, CheckCircle2, Clock3, Loader2, Plus, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useStaffDirectory } from '@/hooks/useStaffDirectory';
import { useAuth } from '@/hooks/useAuth';
import { mergeStaffChoices } from '@/lib/staffFallback';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import {
  cancelStaffTimeOffRequest,
  createStaffTimeOffRequest,
  decideStaffTimeOffRequest,
  getAnnualLeaveBalanceV1,
  getPermissionPolicyStatusV2,
  listStaffTimeOffRequests,
  type AnnualLeaveBalanceV1,
  type PermissionPolicyStatusV2,
  type StaffTimeOffRequest,
  type TimeOffKind,
  type TimeOffStatus,
} from '@/lib/timeOffService';

const TYPE_OPTIONS: Array<{ label: string; kind: TimeOffKind; defaultMinutes?: number }> = [
  { label: 'إذن تأخير', kind: 'permission' },
  { label: 'إذن ساعة', kind: 'permission', defaultMinutes: 60 },
  { label: 'إذن ساعتين', kind: 'permission', defaultMinutes: 120 },
  { label: 'إذن خروج وعودة', kind: 'permission' },
  { label: 'إذن انصراف مبكر', kind: 'permission' },
  { label: 'إجازة سنوية', kind: 'annual_leave' },
  { label: 'إجازة مرضية', kind: 'sick_leave' },
  { label: 'إجازة عارضة', kind: 'exceptional_leave' },
  { label: 'غياب بإذن', kind: 'approved_absence' },
  { label: 'تبديل شيفت', kind: 'shift_swap' },
];

const STATUS_LABELS: Record<TimeOffStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
};

function minutesBetween(start: string, end: string) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return null;
  let value = eh * 60 + em - (sh * 60 + sm);
  if (value < 0) value += 24 * 60;
  return value;
}

function statusClass(status: TimeOffStatus) {
  if (status === 'approved') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (status === 'rejected' || status === 'cancelled') return 'border-red-500/40 bg-red-500/10 text-red-300';
  return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
}

export default function TimeOff() {
  const { user, checkPermission, canManage } = useAuth();
  const canCreate = checkPermission('create_leave_request') || canManage;
  const canApprove = checkPermission('approve_leave_request') || checkPermission('manage_time_off') || canManage;
  const canManageTimeOff = checkPermission('manage_time_off') || canManage;
  const { data: staffDirectory = [] } = useStaffDirectory();
  const staffChoices = useMemo(
    () => mergeStaffChoices(staffDirectory.filter((item) => item.source !== 'alias' && item.active && Boolean(item.id) && Boolean(item.name))),
    [staffDirectory]
  );
  const availableStaff = useMemo(() => {
    if (canManageTimeOff || canApprove) return staffChoices;
    return staffChoices.filter((item) => item.id === user?.staffId || item.name === user?.name);
  }, [canApprove, canManageTimeOff, staffChoices, user?.name, user?.staffId]);

  const [rows, setRows] = useState<StaffTimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | TimeOffStatus>('all');
  const [selectedPolicy, setSelectedPolicy] = useState<PermissionPolicyStatusV2 | null>(null);
  const [annualBalance, setAnnualBalance] = useState<AnnualLeaveBalanceV1 | null>(null);
  const [form, setForm] = useState({
    staffId: user?.staffId || '',
    typeLabel: TYPE_OPTIONS[0].label,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    startTime: '',
    endTime: '',
    durationMinutes: '',
    reason: '',
  });

  const selectedType = TYPE_OPTIONS.find((item) => item.label === form.typeLabel) || TYPE_OPTIONS[0];
  const selectedStaff = staffChoices.find((item) => item.id === form.staffId);
  const isPermission = selectedType.kind === 'permission';
  const isRangeLeave = ['annual_leave', 'sick_leave', 'exceptional_leave'].includes(selectedType.kind);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listStaffTimeOffRequests({ status: statusFilter === 'all' ? null : statusFilter, limit: 300 });
      setRows(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل سجل الإذونات والإجازات');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  useEffect(() => {
    if (!form.staffId) { setSelectedPolicy(null); setAnnualBalance(null); return; }
    const cycle = getCurrentCycle();
    const year = Number(form.startDate.slice(0, 4));
    void Promise.all([
      getPermissionPolicyStatusV2(form.staffId, cycle.start.toISOString().slice(0, 10), cycle.end.toISOString().slice(0, 10)),
      getAnnualLeaveBalanceV1(form.staffId, year),
    ]).then(([policy, balance]) => {
      setSelectedPolicy(policy);
      setAnnualBalance(balance);
    }).catch(() => {
      setSelectedPolicy(null);
      setAnnualBalance(null);
    });
  }, [form.staffId, form.startDate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreate) return toast.error('ليس لديك صلاحية إنشاء طلب.');
    if (!selectedStaff) return toast.error('اختار موظفًا صحيحًا من دليل الموظفين.');
    const duration = isPermission
      ? (minutesBetween(form.startTime, form.endTime) ?? Number(form.durationMinutes || selectedType.defaultMinutes || 0))
      : null;
    if (isPermission && (!duration || duration <= 0)) return toast.error('حدد مدة الإذن بدقة.');
    if (!form.reason.trim()) return toast.error('اكتب سبب الطلب.');

    setSaving(true);
    try {
      await createStaffTimeOffRequest({
        staffId: selectedStaff.id,
        kind: selectedType.kind,
        label: selectedType.label,
        startDate: form.startDate,
        endDate: isRangeLeave ? form.endDate : form.startDate,
        startTime: isPermission && form.startTime ? form.startTime : null,
        endTime: isPermission && form.endTime ? form.endTime : null,
        durationMinutes: duration,
        reason: form.reason.trim(),
      });
      toast.success('تم تسجيل الطلب للمراجعة مع Audit كامل. لا يوجد خصم نقاط مباشر من هذه الصفحة.');
      setForm((current) => ({ ...current, reason: '', startTime: '', endTime: '', durationMinutes: String(selectedType.defaultMinutes || '') }));
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ الطلب');
    } finally {
      setSaving(false);
    }
  }

  async function decide(row: StaffTimeOffRequest, decision: 'approved' | 'rejected') {
    if (!canApprove) return toast.error('ليس لديك صلاحية اعتماد الطلبات.');
    const note = window.prompt(decision === 'approved' ? 'ملاحظة الاعتماد (اختياري)' : 'سبب الرفض') || '';
    if (decision === 'rejected' && !note.trim()) return toast.error('سبب الرفض مطلوب.');
    try {
      await decideStaffTimeOffRequest(row.id, decision, note);
      toast.success(decision === 'approved' ? 'تم اعتماد الطلب.' : 'تم رفض الطلب.');
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحديث الطلب');
    }
  }

  async function cancel(row: StaffTimeOffRequest) {
    const reason = window.prompt('اكتب سبب الإلغاء. السجل لن يُحذف وسيظل محفوظًا في الـAudit.') || '';
    if (!reason.trim()) return;
    try {
      await cancelStaffTimeOffRequest(row.id, reason);
      toast.success('تم إلغاء الطلب مع الاحتفاظ بالتاريخ الكامل.');
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إلغاء الطلب');
    }
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="section-title">الإذونات والإجازات</div>
          <div className="mt-1 text-sm text-slate-400">مصدر موحد للإذن والإجازة والغياب بإذن. الاعتماد منفصل عن أي أثر مالي أو نقاط.</div>
        </div>
        <button onClick={() => void loadRows()} className="btn-secondary"><RefreshCw size={16} /> تحديث</button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4"><div className="text-xs text-slate-400">الأذونات المعتمدة في الدورة</div><div className="mt-1 text-2xl font-black">{selectedPolicy ? `${selectedPolicy.approved_permissions} / ${selectedPolicy.allowance}` : '-'}</div><div className="mt-1 text-xs text-slate-400">المتبقي: {selectedPolicy?.remaining ?? '-'}</div></div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4"><div className="text-xs text-slate-400">حد الإذن الواحد</div><div className="mt-1 text-2xl font-black">{selectedPolicy ? `${selectedPolicy.max_minutes_per_permission} دقيقة` : '-'}</div><div className="mt-1 text-xs text-slate-400">أي تجاوز يذهب للمراجعة ولا يخصم تلقائيًا.</div></div>
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4"><div className="text-xs text-slate-400">رصيد الإجازة السنوية المسجل</div><div className="mt-1 text-2xl font-black">{annualBalance ? annualBalance.balance : '-'}</div><div className="mt-1 text-xs text-slate-400">الاستحقاق السنوي لم يتم افتراضه حتى اعتماد السياسة.</div></div>
      </div>

      {canCreate && <form onSubmit={submit} className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-700 bg-slate-900/50 p-4 md:grid-cols-6">
        <select value={form.staffId} onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value }))} className="input-dark" required><option value="">اختار الموظف</option>{availableStaff.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.role} - {item.branch}</option>)}</select>
        <select value={form.typeLabel} onChange={(e) => { const next = TYPE_OPTIONS.find((item) => item.label === e.target.value) || TYPE_OPTIONS[0]; setForm((f) => ({ ...f, typeLabel: next.label, durationMinutes: String(next.defaultMinutes || '') })); }} className="input-dark">{TYPE_OPTIONS.map((item) => <option key={item.label}>{item.label}</option>)}</select>
        <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))} className="input-dark" />
        {isRangeLeave ? <input type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className="input-dark" /> : <div className="input-dark flex items-center text-sm text-slate-400"><CalendarDays size={15} className="ml-2" /> يوم واحد</div>}
        {isPermission ? <><input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} className="input-dark" /><input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} className="input-dark" /><input type="number" min="1" max="1440" placeholder="المدة بالدقائق" value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))} className="input-dark" /></> : null}
        <textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="سبب واضح للطلب" className="input-dark min-h-20 md:col-span-4" />
        <button disabled={saving} className="btn-primary md:col-span-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} تسجيل الطلب</button>
      </form>}

      <div className="flex flex-wrap gap-2">{(['all','pending','approved','rejected','cancelled'] as const).map((status) => <button key={status} onClick={() => setStatusFilter(status)} className={statusFilter === status ? 'btn-primary' : 'btn-secondary'}>{status === 'all' ? 'الكل' : STATUS_LABELS[status]}</button>)}</div>

      {loading ? <div className="flex items-center justify-center rounded-2xl border border-slate-700 p-10"><Loader2 className="animate-spin" /></div> : rows.length === 0 ? <div className="rounded-2xl border border-slate-700 p-8 text-center text-slate-400">لا توجد طلبات في هذا النطاق.</div> : <div className="overflow-x-auto rounded-2xl border border-slate-700"><table className="min-w-full text-sm"><thead className="bg-slate-900/70 text-right"><tr><th className="p-3">الموظف</th><th className="p-3">النوع</th><th className="p-3">الفترة</th><th className="p-3">المدة</th><th className="p-3">الحالة</th><th className="p-3">السبب</th><th className="p-3">القرار</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-slate-800"><td className="p-3 font-bold">{row.staff_name_snapshot}<div className="text-xs text-slate-500">{row.branch_snapshot || '-'}</div></td><td className="p-3">{row.request_label || row.request_kind}</td><td className="p-3">{row.start_date}{row.end_date !== row.start_date ? ` ← ${row.end_date}` : ''}</td><td className="p-3">{row.duration_minutes ? `${row.duration_minutes} د` : '-'}</td><td className="p-3"><span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusClass(row.status)}`}>{STATUS_LABELS[row.status]}</span></td><td className="max-w-sm p-3 text-slate-300">{row.reason || '-'}</td><td className="p-3"><div className="flex flex-wrap gap-1">{row.status === 'pending' && canApprove && <><button onClick={() => void decide(row,'approved')} className="btn-secondary"><CheckCircle2 size={14} /> اعتماد</button><button onClick={() => void decide(row,'rejected')} className="btn-secondary"><XCircle size={14} /> رفض</button></>}{row.status !== 'cancelled' && (canManageTimeOff || row.staff_id === user?.staffId) && <button onClick={() => void cancel(row)} className="btn-secondary"><Ban size={14} /> إلغاء</button>}{row.decided_at && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Clock3 size={13} /> {row.decided_by_name || 'إدارة'}</span>}</div></td></tr>)}</tbody></table></div>}
    </div>
  );
}
