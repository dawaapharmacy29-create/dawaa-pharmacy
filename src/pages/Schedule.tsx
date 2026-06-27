import { useState } from 'react';
import { Stethoscope, Truck } from 'lucide-react';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { DAYS_AR, BRANCHES } from '@/lib/constants';
import { replaceStaffShiftSchedules } from '@/services/shiftScheduleService';
import { isActiveStaffFilter, staffRowIsActive } from '@/lib/staffActiveFilter';
import { isCurrentlyOnShift } from '@/lib/utils';
import { parseScheduleImport, type ParsedScheduleImport } from '@/lib/shiftParser';
import { saveScheduleImport, type StaffingSaveReport } from '@/lib/api/staffing';
import { toast } from 'sonner';

interface Employee {
  id: string;
  name: string;
  role: string;
  branch: string;
  status: string;
  shift_start?: string | null;
  shift_end?: string | null;
}

interface ShiftSchedule {
  id: string;
  staff_id?: string | null;
  staff_name: string;
  branch: string;
  day_name: string;
  shift_start: string | null;
  shift_end: string | null;
  is_off: boolean | null;
  is_day_off?: boolean | null;
}

interface ShiftException {
  id: string;
  staff_name: string;
  type: string;
  status: string;
  branch: string | null;
  day_name: string | null;
  date: string | null;
  date_end: string | null;
  reason: string | null;
}

const ROLE_COLORS: Record<string, string> = {
  صيدلاني: 'bg-teal-500/15 border-teal-500/25 text-teal-300',
  مساعد: 'bg-blue-500/15 border-blue-500/25 text-blue-300',
  توصيل: 'bg-amber-500/15 border-amber-500/25 text-amber-300',
  'خدمة عملاء': 'bg-purple-500/15 border-purple-500/25 text-purple-300',
  'مدير فرع': 'bg-pink-500/15 border-pink-500/25 text-pink-300',
};

function normalizeBranch(branch?: string | null) {
  const value = String(branch || '');
  if (
    value.includes('أبو العزم') ||
    value.includes('ابو العزم') ||
    value.includes('العزم') ||
    value.includes('شكري')
  )
    return 'فرع شكري';
  if (value.includes('شامي') || value.includes('الشامى')) return 'فرع الشامي';
  return value || 'غير محدد';
}

export default function Schedule() {
  const [branchFilter, setBranchFilter] = useState('الكل');
  const [roleFilter, setRoleFilter] = useState('الكل');
  const [preview, setPreview] = useState<ParsedScheduleImport | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveReport, setSaveReport] = useState<StaffingSaveReport | null>(null);
  const today = new Date().getDay();

  const { data: employees, loading } = useSupabaseQuery<Employee>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    orderBy: { column: 'name', ascending: true },
    realtimeEnabled: true,
  });
  const { data: schedules, loading: schedulesLoading } = useSupabaseQuery<ShiftSchedule>({
    table: 'shift_schedules',
    realtimeEnabled: true,
  });
  const { data: exceptions } = useSupabaseQuery<ShiftException>({
    table: 'shift_exceptions',
    filters: [{ column: 'status', operator: 'eq', value: 'approved' }],
    realtimeEnabled: true,
  });

  const filtered = employees.filter(
    (e) =>
      staffRowIsActive(e) &&
      e.status === 'نشط' &&
      (branchFilter === 'الكل' || normalizeBranch(e.branch) === branchFilter) &&
      (roleFilter === 'الكل' || e.role === roleFilter)
  );

  const scheduleFor = (emp: Employee, day: string) => {
    // First check for approved leave/exceptions
    const today = new Date();
    const dayIndex = DAYS_AR.indexOf(day);
    const targetDate = new Date(today);
    const diff = dayIndex - today.getDay();
    targetDate.setDate(today.getDate() + diff);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    const exception = exceptions?.find(
      (item) =>
        item.staff_name === emp.name &&
        normalizeBranch(item.branch) === normalizeBranch(emp.branch) &&
        item.status === 'approved' &&
        (item.type.includes('إجازة') || item.type === 'غياب') &&
        ((item.date &&
          item.date <= targetDateStr &&
          (!item.date_end || item.date_end >= targetDateStr)) ||
          item.day_name === day)
    );

    if (exception) {
      return {
        staff_name: emp.name,
        branch: emp.branch,
        day_name: day,
        shift_start: null,
        shift_end: null,
        is_off: true,
        is_day_off: false,
      };
    }

    const candidates = schedules.filter(
      (item) =>
        (item.staff_id === emp.id || item.staff_name === emp.name) &&
        normalizeBranch(item.branch) === normalizeBranch(emp.branch) &&
        item.day_name === day
    );

    // لو فيه سجلات مكررة لنفس الموظف/اليوم، لا نسمح لسجل إجازة قديم يطغى على شيفت صحيح.
    // الأولوية: سجل فيه وقت بداية ونهاية، ثم أحدث سجل، ثم إجازة لو لا يوجد شيفت.
    const working = candidates.find(
      (item) =>
        item.is_off !== true && item.is_day_off !== true && item.shift_start && item.shift_end
    );
    if (working) return working;
    return candidates[0] || null;
  };

  const normalShiftFor = (emp: Employee) => {
    const counts = new Map<string, number>();
    schedules
      .filter(
        (item) =>
          (item.staff_id === emp.id || item.staff_name === emp.name) &&
          normalizeBranch(item.branch) === normalizeBranch(emp.branch) &&
          item.is_off !== true &&
          item.is_day_off !== true &&
          item.shift_start &&
          item.shift_end
      )
      .forEach((item) => {
        const key = `${item.shift_start}-${item.shift_end}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  };

  if (loading || schedulesLoading)
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="stat-card h-16 animate-pulse bg-white/5" />
        ))}
      </div>
    );

  const handleShiftFile = async (file?: File) => {
    if (!file) return;
    setParsing(true);
    setSaveReport(null);
    try {
      const result = await parseScheduleImport(file);
      setPreview(result);
      toast.success(`تمت قراءة ${result.staffCount} عضو فريق من ملف الشيفتات`);
    } catch (error) {
      toast.error(`تعذر قراءة ملف الشيفتات: ${(error as Error).message}`);
    } finally {
      setParsing(false);
    }
  };

  const regenerateWeeklySchedule = async (emp: Employee) => {
    if (!emp.shift_start || !emp.shift_end) {
      toast.error('لا يوجد ميعاد أساسي لهذا الموظف لإعادة إنشاء الجدول.');
      return;
    }
    const confirmed = window.confirm(
      `إعادة إنشاء جدول أسبوعي لـ ${emp.name} بناء على الميعاد الأساسي؟`
    );
    if (!confirmed) return;
    const records = DAYS_AR.map((day, index) => ({
      staff_id: emp.id,
      staff_name: emp.name,
      branch: normalizeBranch(emp.branch),
      day_name: day,
      day_of_week: index,
      shift_start: emp.shift_start || null,
      shift_end: emp.shift_end || null,
      is_off: false,
      is_day_off: false,
      is_different: false,
      has_custom_time: false,
      notes: 'regenerated_from_base_shift',
    }));
    const { error } = await replaceStaffShiftSchedules(emp.id, records);
    if (error) {
      toast.error('تعذر إعادة إنشاء الجدول الأسبوعي.');
      return;
    }
    toast.success('تمت إعادة إنشاء الجدول الأسبوعي.');
  };

  const handleSavePreview = async () => {
    if (!preview) return;
    if (!preview.validation.valid) {
      toast.error('يوجد أخطاء في ملف الشيفتات. راجع تقرير التحقق قبل الحفظ.');
      return;
    }
    if (!window.confirm('سيتم حفظ بيانات الفريق والشيفتات المقروءة من الملف. هل تريد المتابعة؟'))
      return;
    setSaving(true);
    try {
      const report = await saveScheduleImport(preview);
      setSaveReport(report);
      toast.success(`تم حفظ ${report.staffSaved} عضو فريق`);
    } catch (error) {
      toast.error(`تعذر حفظ بيانات الجدول: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const exportValidationReport = () => {
    if (!preview) return;
    const issues = [...preview.validation.errors, ...preview.validation.warnings];
    const csv = [
      ['level', 'staffName', 'branch', 'day', 'message', 'raw', 'start', 'end', 'hours', 'role'],
      ...issues.map((issue) => [
        issue.level,
        issue.staffName,
        issue.branch,
        issue.day,
        issue.message,
        issue.raw || '',
        issue.start || '',
        issue.end || '',
        issue.hours ?? '',
        issue.role || '',
      ]),
    ]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `schedule-validation-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="section-title">الجدول الأسبوعي</div>
        <div className="mr-auto flex gap-2 flex-wrap">
          {['الكل', ...BRANCHES].map((b) => (
            <button
              key={b}
              onClick={() => setBranchFilter(b)}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${branchFilter === b ? 'bg-teal-500/15 border-teal-500/30 text-teal-400' : 'border-[#2d4063] text-slate-400 hover:border-teal-500/20'}`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['الكل', 'صيدلاني', 'توصيل'].map((role) => (
          <button
            key={role}
            onClick={() => setRoleFilter(role)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all flex items-center gap-2 ${roleFilter === role ? 'bg-teal-500/15 border-teal-500/30 text-teal-400' : 'border-[#2d4063] text-slate-400 hover:border-teal-500/20'}`}
          >
            {role === 'صيدلاني' && <Stethoscope size={15} />}
            {role === 'توصيل' && <Truck size={15} />}
            {role === 'الكل' ? 'كل الفريق' : role === 'صيدلاني' ? 'الدكاترة فقط' : 'الدليفري فقط'}
          </button>
        ))}
      </div>

      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1">
            <div className="text-white font-bold text-sm">استيراد شيفتات Excel</div>
            <div className="text-slate-400 text-xs mt-1">
              يدعم الشيفتات التي تتعدى منتصف الليل مثل 7 PM → 3 AM. المعاينة فقط قبل أي حفظ.
            </div>
          </div>
          <label className="btn-secondary cursor-pointer">
            {parsing ? 'جاري القراءة...' : 'اختيار ملف'}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => handleShiftFile(event.target.files?.[0])}
            />
          </label>
        </div>
        {preview && (
          <div className="mt-4 overflow-x-auto max-h-72 overflow-y-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
              <MiniStat label="الفروع" value={preview.branchCount} />
              <MiniStat label="الفريق" value={preview.staffCount} />
              <MiniStat label="دكاترة" value={preview.doctorCount} />
              <MiniStat label="دليفري" value={preview.deliveryCount} />
              <MiniStat label="شيفتات" value={preview.shiftCount} />
              <MiniStat label="إجازات" value={preview.offCount} />
              <MiniStat label="أخطاء" value={preview.validation.errors.length} />
              <MiniStat label="تحذيرات" value={preview.validation.warnings.length} />
            </div>
            {(preview.validation.errors.length > 0 || preview.validation.warnings.length > 0) && (
              <div className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
                <div className="mb-2 text-sm font-black text-amber-100">
                  تقرير التحقق قبل الحفظ: {preview.validation.errors.length} أخطاء ·{' '}
                  {preview.validation.warnings.length} تحذيرات
                </div>
                <div className="max-h-48 space-y-2 overflow-y-auto text-xs leading-6">
                  {[...preview.validation.errors, ...preview.validation.warnings]
                    .slice(0, 30)
                    .map((issue, index) => (
                      <div
                        key={`${issue.level}-${issue.staffName}-${issue.day}-${index}`}
                        className={
                          issue.level === 'error'
                            ? 'rounded-xl border border-red-400/25 bg-red-500/10 p-2 text-red-100'
                            : 'rounded-xl border border-amber-400/25 bg-amber-500/10 p-2 text-amber-100'
                        }
                      >
                        <b>{issue.level === 'error' ? 'خطأ' : 'تحذير'}:</b> {issue.staffName} ·{' '}
                        {issue.branch} · {issue.day} — {issue.message}
                        {issue.raw ? (
                          <span className="block text-slate-300">القيمة: {issue.raw}</span>
                        ) : null}
                      </div>
                    ))}
                </div>
                {preview.validation.errors.length > 0 && (
                  <div className="mt-3 text-xs font-bold text-red-100">
                    لن يتم الحفظ قبل إصلاح الأخطاء حتى لا تتلف الجداول الحالية.
                  </div>
                )}
                {preview.validation.errors.length === 0 &&
                  preview.validation.warnings.length > 0 && (
                    <div className="mt-3 text-xs font-bold text-amber-100">
                      يمكن الحفظ مع وجود تحذيرات بعد المراجعة
                    </div>
                  )}
                <button
                  type="button"
                  onClick={exportValidationReport}
                  className="btn-secondary mt-3 px-3 py-2 text-xs"
                >
                  تصدير تقرير التحقق CSV
                </button>
              </div>
            )}
            <table className="data-table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الفرع</th>
                  <th>النوع</th>
                  <th>عدد الأيام المقروءة</th>
                  <th>مثال شيفت</th>
                </tr>
              </thead>
              <tbody>
                {preview.staff.slice(0, 40).map((item) => {
                  const firstShift = Object.entries(item.shifts)[0];
                  return (
                    <tr key={`${item.branch}-${item.name}`}>
                      <td>{item.name}</td>
                      <td>{normalizeBranch(item.branch)}</td>
                      <td>{item.role}</td>
                      <td className="num">{Object.keys(item.shifts).length}</td>
                      <td>
                        {firstShift
                          ? `${firstShift[0]}: ${firstShift[1].isOff ? 'إجازة' : `${firstShift[1].start} - ${firstShift[1].end}`}`
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-col md:flex-row gap-3 md:items-center mt-4">
              <button
                onClick={handleSavePreview}
                disabled={saving || preview.validation.errors.length > 0}
                className="btn-primary"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ البيانات المقروءة'}
              </button>
              <div className="text-amber-300 text-xs">
                الحفظ يستخدم الجداول الموجودة فقط. لو shift_schedules أو shift_exceptions غير موجودة
                سيظهر ذلك في التقرير.
              </div>
            </div>
            {saveReport && (
              <div className="mt-4 bg-white/5 border border-[#2d4063] rounded-xl p-4 text-sm">
                <div className="text-white font-bold mb-2">تقرير الحفظ</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-slate-300">
                  <div>
                    جدول الفريق:{' '}
                    <span className="text-teal-300">{saveReport.staffTable || 'غير موجود'}</span>
                  </div>
                  <div>
                    الفريق المحفوظ:{' '}
                    <span className="num text-teal-300">{saveReport.staffSaved}</span>
                  </div>
                  <div>
                    الشيفتات: <span className="num text-teal-300">{saveReport.shiftsSaved}</span>
                  </div>
                  <div>
                    الإجازات: <span className="num text-teal-300">{saveReport.leavesSaved}</span>
                  </div>
                </div>
                {saveReport.skipped.length > 0 && (
                  <div className="mt-3 space-y-1 text-amber-200 text-xs">
                    {saveReport.skipped.map((item) => (
                      <div key={item}>• {item}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-[#1B2B4B] border border-[#2d4063] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-right text-xs font-semibold text-slate-400 uppercase px-4 py-3 bg-[#152235] border-b border-[#2d4063] min-w-[160px]">
                  الموظف
                </th>
                {DAYS_AR.map((day, i) => (
                  <th
                    key={day}
                    className={`text-center text-xs font-semibold px-3 py-3 bg-[#152235] border-b border-[#2d4063] min-w-[100px] ${i === today ? 'text-teal-400' : 'text-slate-400'}`}
                  >
                    {day}
                    {i === today && (
                      <div className="w-1.5 h-1.5 rounded-full bg-teal-400 mx-auto mt-0.5" />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr
                  key={emp.id}
                  className="border-b border-[#2d4063]/50 last:border-0 hover:bg-white/2"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-teal-500/15 flex items-center justify-center text-teal-400 text-xs font-bold flex-shrink-0">
                        {emp.name[0]}
                      </div>
                      <div>
                        <div className="text-white text-xs font-medium flex items-center gap-1.5">
                          {emp.role === 'صيدلاني' && (
                            <Stethoscope size={13} className="text-teal-300" />
                          )}
                          {emp.role === 'توصيل' && <Truck size={13} className="text-amber-300" />}
                          {emp.name}
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border ${ROLE_COLORS[emp.role] || ''}`}
                        >
                          {emp.role}
                        </span>
                        <div className="text-slate-500 text-[11px] mt-0.5">
                          {normalizeBranch(emp.branch)}
                        </div>
                        <button
                          type="button"
                          onClick={() => regenerateWeeklySchedule(emp)}
                          className="text-[11px] text-teal-300 hover:text-teal-200 mt-1"
                        >
                          إعادة إنشاء الجدول
                        </button>
                      </div>
                    </div>
                  </td>
                  {DAYS_AR.map((day, i) => {
                    const shift = scheduleFor(emp, day);
                    const isHoliday = shift?.is_off === true || shift?.is_day_off === true;
                    const isToday = i === today;
                    const onShift =
                      isToday &&
                      shift?.shift_start &&
                      shift?.shift_end &&
                      isCurrentlyOnShift(shift.shift_start, shift.shift_end) &&
                      emp.status === 'نشط';
                    const normalShift = normalShiftFor(emp);
                    const shiftKey =
                      shift?.shift_start && shift?.shift_end
                        ? `${shift.shift_start}-${shift.shift_end}`
                        : '';
                    const isDifferent = Boolean(
                      shiftKey && normalShift && shiftKey !== normalShift
                    );
                    return (
                      <td
                        key={day}
                        className={`px-2 py-3 text-center ${isToday ? 'bg-teal-500/3' : ''}`}
                      >
                        {isHoliday ? (
                          <span className="inline-block bg-red-500/20 border-2 border-red-400/50 text-red-200 text-xs px-3 py-2 rounded-xl shadow-[0_0_0_1px_rgba(248,113,113,.15)]">
                            إجازة
                          </span>
                        ) : !shift ? (
                          <span className="inline-block bg-white/5 border border-[#2d4063] text-slate-500 text-xs px-2 py-1 rounded-lg">
                            غير محدد
                          </span>
                        ) : (
                          <div
                            className={`inline-flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg border text-xs ${isDifferent ? 'bg-amber-500/15 border-amber-400/40 text-amber-200' : onShift ? 'bg-teal-500/15 border-teal-500/30 text-teal-300' : 'bg-white/3 border-[#2d4063] text-slate-400'}`}
                          >
                            <span className="font-medium">{shift.shift_start || '-'}</span>
                            <span className="text-slate-500">—</span>
                            <span className="font-medium">{shift.shift_end || '-'}</span>
                            {isDifferent && (
                              <span className="text-amber-300 text-[10px] font-bold">مختلف</span>
                            )}
                            {onShift && (
                              <span className="text-teal-400 text-[10px] font-bold">نشط ●</span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-slate-400">لا يوجد موظفون نشطون</div>
        )}
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {filtered.map((emp) => (
          <div key={emp.id} className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-teal-500/15 flex items-center justify-center text-teal-400 font-bold">
                {emp.name[0]}
              </div>
              <div>
                <div className="text-white font-bold text-sm">{emp.name}</div>
                <div className="flex gap-2 mt-0.5">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border ${ROLE_COLORS[emp.role] || ''}`}
                  >
                    {emp.role}
                  </span>
                  <span className="text-slate-400 text-xs">{emp.branch}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {DAYS_AR.map((day, i) => {
                const shift = scheduleFor(emp, day);
                const isHoliday = shift?.is_off === true || shift?.is_day_off === true;
                const isToday = i === today;
                return (
                  <div
                    key={day}
                    className={`rounded-xl p-2 text-center border ${isToday ? 'bg-teal-500/10 border-teal-500/25' : 'bg-white/3 border-[#2d4063]'}`}
                  >
                    <div
                      className={`text-xs font-medium mb-1 ${isToday ? 'text-teal-400' : 'text-slate-400'}`}
                    >
                      {day.substring(0, 3)}
                    </div>
                    {isHoliday ? (
                      <div className="text-red-400 text-xs">إجازة</div>
                    ) : shift ? (
                      <div className="text-xs text-slate-300 leading-tight">
                        {shift.shift_start || '-'}
                        <br />—<br />
                        {shift.shift_end || '-'}
                      </div>
                    ) : (
                      <div className="text-slate-500 text-xs">غير محدد</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/5 border border-[#2d4063] rounded-xl p-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white font-bold num mt-1">{value}</div>
    </div>
  );
}
