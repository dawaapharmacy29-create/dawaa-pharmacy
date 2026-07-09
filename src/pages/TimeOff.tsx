import { useMemo, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import { applyStaffDelta, persistPointsTransaction } from '@/lib/pointsPersistence';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { mergeStaffChoices, type StaffChoice } from '@/lib/staffFallback';
import type { EvaluationRuleDef } from '@/lib/evaluationRulesCatalog';
import { getSafeCurrentUserId, useAuth } from '@/hooks/useAuth';
import { canonicalMaxPoints, canonicalSnapshotPoints } from '@/lib/pointsLedger';

const TYPES = ['إذن تأخير', 'إذن ساعة', 'إذن ساعتين', 'إذن خروج وعودة', 'إذن انصراف مبكر', 'إجازة مرضية', 'إجازة عارضة', 'غياب', 'تبديل شيفت'];
const STATUSES = ['pending', 'approved', 'rejected'];

interface Staff extends StaffChoice {
  phone?: string | null;
}

interface ShiftException {
  id: string;
  staff_id?: string | null;
  staff_name: string;
  type: string;
  status: string;
  branch: string | null;
  day_name: string | null;
  date: string | null;
  date_end?: string | null;
  reason: string | null;
  deduct_points?: boolean | null;
  deduction_points?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  duration_hours?: number | null;
}

function dayName(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'long' });
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || '';
}

async function insertShiftException(payload: Record<string, unknown>) {
  const next = { ...payload };
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 12; attempt++) {
    const { error } = await supabase.from(TABLES.shiftExceptions).insert(next);
    if (!error) return null;
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) return error.message;
    removed.add(column);
    delete next[column];
  }

  return 'تعذر حفظ الإذن بسبب اختلاف أعمدة جدول shift_exceptions.';
}

async function updateShiftException(id: string, payload: Record<string, unknown>) {
  const next = { ...payload };
  const removed = new Set<string>();
  for (let attempt = 0; attempt < 12; attempt++) {
    const { error } = await supabase.from(TABLES.shiftExceptions).update(next).eq('id', id);
    if (!error) return null;
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) return error.message;
    removed.add(column);
    delete next[column];
  }
  return 'تعذر تحديث الإذن بسبب اختلاف أعمدة جدول shift_exceptions.';
}

function timeOffRule(type: string, points: number): EvaluationRuleDef {
  return {
    code: `TIME_OFF_${type.replace(/\s+/g, '_')}`,
    category: 'الإذونات والإجازات',
    title: `خصم ${type}`,
    description: 'خصم يدوي يحدده المدير العام عند تسجيل إذن أو إجازة.',
    default_points: points,
    type: 'deduction',
    severity: points >= 30 ? 'high' : points >= 10 ? 'medium' : 'low',
    role_scope: 'all',
    requires_approval: false,
    evidence_required: false,
    allowed_approver_roles: ['general_manager'],
    repeat_policy: 'none',
    active: true,
  };
}

function hoursBetween(start: string, end: string) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}

function defaultDurationForType(type: string) {
  if (type.includes('ساعتين')) return '2';
  if (type.includes('ساعة')) return '1';
  return '';
}

export default function TimeOff() {
  const { user, checkPermission, canManage } = useAuth();
  const canCreateRequest = checkPermission('create_leave_request') || canManage;
  const canApproveRequest = checkPermission('approve_leave_request') || canManage;
  const canManageTimeOff = checkPermission('manage_time_off') || canManage;
  const { data: staff = [] } = useSupabaseQuery<Staff>({
    table: TABLES.staff,
    filters: isActiveStaffFilter(),
    realtimeEnabled: false,
  });
  const { data: exceptions = [], loading, refetch } = useSupabaseQuery<ShiftException>({
    table: TABLES.shiftExceptions,
    orderBy: { column: 'created_at', ascending: false },
    realtimeEnabled: true,
  });
  const staffChoices = useMemo(() => mergeStaffChoices(staff), [staff]);
  const availableStaffChoices = useMemo(() => {
    if (canManageTimeOff) return staffChoices;
    if (!user) return staffChoices;
    return staffChoices.filter((item) => item.id === user.staffId || item.name === user.name);
  }, [staffChoices, canManageTimeOff, user?.staffId, user?.name]);
  const visibleExceptions = useMemo(() => {
    if (canManageTimeOff || canApproveRequest) return exceptions;
    return exceptions.filter((item) => item.staff_id === user?.staffId || item.staff_name === user?.name);
  }, [exceptions, canManageTimeOff, canApproveRequest, user?.staffId, user?.name]);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    staff_id: '',
    type: 'إذن تأخير',
    status: canApproveRequest ? 'approved' : 'pending',
    date: new Date().toISOString().slice(0, 10),
    date_end: new Date().toISOString().slice(0, 10),
    start_time: '',
    end_time: '',
    duration_hours: '',
    reason: '',
    deduct_points: false,
    deduction_points: '',
  });

  const isLeaveType = form.type.includes('إجازة');
  const isHourlyPermission = form.type.includes('إذن') && !isLeaveType;
  const selectedStaff = staffChoices.find((item) => item.id === form.staff_id);
  const deductionPoints = Math.max(0, Number(form.deduction_points) || 0);
  const calculatedHours = form.start_time && form.end_time ? hoursBetween(form.start_time, form.end_time) : Number(form.duration_hours || defaultDurationForType(form.type) || 0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreateRequest) return toast.error('ليس لديك صلاحية إنشاء طلب إذن أو إجازة.');
    if (!selectedStaff) return toast.error('اختار الموظف الأول.');
    if (form.deduct_points && deductionPoints <= 0) return toast.error('اكتب قيمة الخصم بالنقاط أو اقفل اختيار الخصم.');
    if (isHourlyPermission && calculatedHours <= 0 && !form.reason.trim()) return toast.error('حدد مدة الإذن أو اكتب سبب واضح.');

    setSaving(true);
    const finalStatus = canApproveRequest ? form.status : 'pending';
    const rangeNote = isLeaveType && form.date_end && form.date_end !== form.date ? `[من ${form.date} إلى ${form.date_end}] ` : '';
    const durationNote = isHourlyPermission ? `[مدة الإذن: ${calculatedHours || 'غير محدد'} ساعة${form.start_time ? ` - من ${form.start_time}` : ''}${form.end_time ? ` إلى ${form.end_time}` : ''}] ` : '';
    const deductionNote = form.deduct_points ? `[خصم نقاط: ${deductionPoints}] ` : '[بدون خصم نقاط] ';
    const finalReason = `${rangeNote}${durationNote}${deductionNote}${form.reason}`.trim();

    const payload = {
      staff_name: selectedStaff.name,
      staff_id: selectedStaff.id.startsWith('fallback-') ? null : selectedStaff.id,
      employee_name: selectedStaff.name,
      type: form.type,
      status: finalStatus,
      branch: selectedStaff.branch || null,
      date: form.date,
      date_end: form.date_end || form.date,
      day_name: dayName(form.date),
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      duration_hours: calculatedHours || null,
      duration_minutes: calculatedHours ? Math.round(calculatedHours * 60) : null,
      reason: finalReason,
      deduct_points: form.deduct_points,
      deduction_points: deductionPoints,
      deduction_status: form.deduct_points ? finalStatus : 'none',
      source: 'manual',
      updated_at: new Date().toISOString(),
    };

    const error = editingId ? await updateShiftException(editingId, payload) : await insertShiftException(payload);
    if (error) {
      setSaving(false);
      toast.error('تعذر حفظ الإذن: ' + error);
      return;
    }

    if (form.deduct_points && deductionPoints > 0) {
      const status = finalStatus === 'approved' ? 'approved' : 'pending';
      const result = await persistPointsTransaction({
        employeeId: selectedStaff.id,
        employeeName: selectedStaff.name,
        branch: selectedStaff.branch,
        operation: 'deduction',
        rule: timeOffRule(form.type, deductionPoints),
        pointsToStore: deductionPoints,
        basePoints: deductionPoints,
        finalPoints: deductionPoints,
        userNote: finalReason,
        createdByName: 'المدير العام',
        createdById: getSafeCurrentUserId() ?? null,
        createdByRole: 'مدير عام',
        status,
        cycle: getCurrentCycle(),
        sourceModule: 'time_off',
        reasonLabel: `${form.type} - خصم محدد من المدير`,
      });
      if (result.error) toast.warning('تم حفظ الإذن، لكن لم يتم تسجيل الخصم في النقاط: ' + result.error);
      else if (status === 'approved' && !selectedStaff.id.startsWith('fallback-')) {
        await applyStaffDelta(selectedStaff.id, canonicalSnapshotPoints(selectedStaff), canonicalMaxPoints(selectedStaff), -deductionPoints, selectedStaff.name, selectedStaff.branch);
      }
    }

    setSaving(false);
    toast.success(form.deduct_points ? 'تم حفظ الإذن وتسجيل خصم النقاط.' : 'تم حفظ الإذن/الإجازة بدون خصم نقاط.');
    setEditingId(null);
    setForm((current) => ({
      ...current,
      reason: '',
      start_time: '',
      end_time: '',
      duration_hours: defaultDurationForType(current.type),
      deduction_points: current.deduct_points ? current.deduction_points : '',
    }));
    refetch();
  };

  const editItem = (item: ShiftException, forceDeduction = false) => {
    const staffItem = staffChoices.find((choice) => choice.id === item.staff_id || choice.name === item.staff_name);
    setEditingId(item.id);
    setForm({
      staff_id: staffItem?.id || '',
      type: item.type || TYPES[0],
      status: item.status || 'pending',
      date: item.date || new Date().toISOString().slice(0, 10),
      date_end: item.date_end || item.date || new Date().toISOString().slice(0, 10),
      start_time: item.start_time || '',
      end_time: item.end_time || '',
      duration_hours: String(item.duration_hours || defaultDurationForType(item.type || '') || ''),
      reason: item.reason || '',
      deduct_points: forceDeduction || Boolean(item.deduct_points),
      deduction_points: String(item.deduction_points || (forceDeduction ? 10 : '')),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteItem = async (item: ShiftException) => {
    if (!canManageTimeOff) return toast.error('الحذف متاح للمديرين المصرح لهم فقط.');
    if (!window.confirm(`هل تريد حذف سجل ${item.type} لـ ${item.staff_name}؟`)) return;
    const { error } = await supabase.from(TABLES.shiftExceptions).delete().eq('id', item.id);
    if (error) return toast.error(`تعذر حذف السجل: ${error.message}`);
    toast.success('تم حذف سجل الإذن/الإجازة');
    refetch();
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="section-title">الإذونات والإجازات</div>
        <div className="text-slate-400 text-sm mt-1">سجل إذن ساعة أو ساعتين أو إجازة، وحدد هل عليه خصم نقاط أم لا.</div>
      </div>

      <form onSubmit={handleSubmit} className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
        <select value={form.staff_id} onChange={(event) => setForm((f) => ({ ...f, staff_id: event.target.value }))} className="input-dark" required>
          <option value="">اختار الموظف</option>
          {availableStaffChoices.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.role} - {item.branch}</option>)}
        </select>
        <select value={form.type} onChange={(event) => setForm((f) => ({ ...f, type: event.target.value, duration_hours: f.duration_hours || defaultDurationForType(event.target.value) }))} className="input-dark">
          {TYPES.map((type) => <option key={type}>{type}</option>)}
        </select>
        <select value={form.status} onChange={(event) => setForm((f) => ({ ...f, status: event.target.value }))} className="input-dark" disabled={!canApproveRequest}>
          {STATUSES.map((status) => <option key={status}>{status}</option>)}
        </select>
        <input type="date" value={form.date} onChange={(event) => setForm((f) => ({ ...f, date: event.target.value, date_end: f.date_end < event.target.value ? event.target.value : f.date_end }))} className="input-dark" />
        {isLeaveType && <input type="date" value={form.date_end} min={form.date} onChange={(event) => setForm((f) => ({ ...f, date_end: event.target.value }))} className="input-dark" />}
        {isHourlyPermission && (
          <>
            <input type="time" value={form.start_time} onChange={(event) => setForm((f) => ({ ...f, start_time: event.target.value }))} className="input-dark" title="بداية الإذن" />
            <input type="time" value={form.end_time} onChange={(event) => setForm((f) => ({ ...f, end_time: event.target.value }))} className="input-dark" title="نهاية الإذن" />
            <input type="number" min="0.25" step="0.25" value={form.duration_hours} onChange={(event) => setForm((f) => ({ ...f, duration_hours: event.target.value }))} placeholder="عدد الساعات" className="input-dark" />
          </>
        )}
        <label className="input-dark flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.deduct_points} onChange={(event) => setForm((f) => ({ ...f, deduct_points: event.target.checked }))} />
          عليه خصم نقاط؟
        </label>
        {form.deduct_points && <input type="number" min={1} value={form.deduction_points} onChange={(event) => setForm((f) => ({ ...f, deduction_points: event.target.value }))} placeholder="قيمة الخصم بالنقاط" className="input-dark md:col-span-2" required />}
        <textarea value={form.reason} onChange={(event) => setForm((f) => ({ ...f, reason: event.target.value }))} placeholder="سبب الإذن أو ملاحظات" className="input-dark md:col-span-4 resize-none" rows={2} />
        {isHourlyPermission && <div className="rounded-xl border border-teal-500/25 bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-100 md:col-span-2">المدة المحسوبة: {calculatedHours || 0} ساعة</div>}
        <button type="submit" disabled={saving || !form.staff_id || !canCreateRequest} className="btn-primary flex items-center justify-center gap-2 md:col-span-6">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          {editingId ? 'تحديث السجل' : 'حفظ'}
        </button>
        {editingId && <button type="button" onClick={() => setEditingId(null)} className="btn-secondary md:col-span-6">إلغاء التعديل</button>}
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TYPES.map((type) => (
          <div key={type} className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-4">
            <div className="text-white font-bold">{type}</div>
            <div className="text-slate-400 text-sm mt-2">الحالات: {STATUSES.join(' / ')}</div>
            <div className="text-slate-400 text-xs mt-3 leading-relaxed">يمكن تسجيله بدون خصم، أو بخصم نقاط يحدده المدير العام. الإذن يدعم ساعة/ساعتين/وقت بداية ونهاية.</div>
          </div>
        ))}
      </div>

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2d4063] text-white font-bold">آخر الإذونات والإجازات</div>
        {loading ? <div className="p-6 text-slate-400">جاري التحميل...</div> : visibleExceptions.length === 0 ? <div className="p-6 text-slate-400">لا توجد إذونات مسجلة بعد.</div> : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>الموظف</th><th>النوع</th><th>الحالة</th><th>الفرع</th><th>اليوم/التاريخ</th><th>المدة</th><th>خصم النقاط</th><th>السبب</th><th>إجراءات</th></tr></thead>
              <tbody>
                {visibleExceptions.map((item) => (
                  <tr key={item.id}>
                    <td>{item.staff_name}</td><td>{item.type}</td>
                    <td><span className={item.status === 'approved' ? 'badge-success' : item.status === 'rejected' ? 'badge-danger' : 'badge-info'}>{item.status}</span></td>
                    <td>{item.branch || '-'}</td><td>{item.date || item.day_name || '-'}</td>
                    <td>{item.duration_hours ? `${item.duration_hours} ساعة` : item.start_time || item.end_time ? `${item.start_time || '-'} - ${item.end_time || '-'}` : '-'}</td>
                    <td>{item.deduct_points ? `${item.deduction_points || 0} نقطة` : 'بدون خصم'}</td><td>{item.reason || '-'}</td>
                    <td><div className="flex flex-wrap gap-2">
                      {(canApproveRequest || canManageTimeOff) && <button type="button" onClick={() => editItem(item)} className="rounded-lg bg-teal-500/15 px-2 py-1 text-xs font-bold text-teal-200">تعديل</button>}
                      {canApproveRequest && <button type="button" onClick={() => editItem(item, true)} className="rounded-lg bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-200">جعله بخصم</button>}
                      {canManageTimeOff && <button type="button" onClick={() => deleteItem(item)} className="rounded-lg bg-red-500/15 px-2 py-1 text-xs font-bold text-red-200">حذف</button>}
                    </div></td>
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
