import type {
  StaffTimeOffRequest, TimeOffPreflightV3,
  createStaffTimeOffRequest, decideStaffTimeOffRequest,
  getTimeOffRequestPreflightV3, listStaffTimeOffRequests,
} from '@/lib/timeOffService';

export type InlinePermissionApi = {
  listRequests: typeof listStaffTimeOffRequests;
  createRequest: typeof createStaffTimeOffRequest;
  preflight: typeof getTimeOffRequestPreflightV3;
  approveRequest: typeof decideStaffTimeOffRequest;
};

export type InlinePermissionInput = {
  staffId: string;
  date: string;
  minutes: number;
  note: string;
};

type PermissionRow = StaffTimeOffRequest;
type Preflight = TimeOffPreflightV3;

/**
 * Reuses an existing matching approved/pending permission. Fail closed on
 * conflicts, policy warnings, and unsafe durations instead of silently
 * creating a duplicate or bypassing manager-level controls.
 *
 * The request and attendance-day approval are distinct canonical operations:
 * the caller may safely retry after a partially completed attendance update.
 */
export async function ensureApprovedPermissionForAttendance(
  input: InlinePermissionInput,
  api: InlinePermissionApi
): Promise<{ requestId: string; minutes: number }> {
  const { staffId, date, minutes, note } = input;
  if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error('مدة الإذن أو هوية يوم الحضور غير صالحة.');
  }
  const all = await api.listRequests({ staffId, from: date, to: date, limit: 100 });
  const active = all.filter((r: PermissionRow) => r.staff_id === staffId
    && r.request_kind === 'permission' && r.start_date === date && r.end_date === date
    && (r.status === 'approved' || r.status === 'pending'));
  if (active.length > 1 || active.some((r: PermissionRow) => r.duration_minutes !== minutes)) {
    throw new Error('يوجد إذن آخر أو أكثر في نفس اليوم بمدة مختلفة؛ راجع الطلبات القائمة قبل الإضافة.');
  }
  let request = active[0];
  if (!request) {
    request = await api.createRequest({
      staffId, kind: 'permission', label: 'إذن حضور من مركز المراجعات',
      startDate: date, durationMinutes: minutes,
      reason: note || `إذن ${minutes} دقيقة بعد مراجعة البصمة`,
    });
  }
  if (request.status === 'approved') return { requestId: request.id, minutes };
  if (request.status !== 'pending') throw new Error('حالة الإذن تغيرت، أعد مراجعة الطلب.');

  const check: Preflight = await api.preflight(request.id);
  if (!check.allowed || check.blockers.length > 0) {
    throw new Error(`تم حفظ طلب الإذن للمراجعة دون اعتماد: ${check.blockers.map((blocker) => blocker.label).join('، ') || 'فشل فحص السياسة'}`);
  }
  if (check.warnings.length > 0) {
    throw new Error(`طلب الإذن محفوظ لكن يحتاج اعتمادًا إداريًا إضافيًا: ${check.warnings.map((warning) => warning.label).join('، ')}`);
  }

  const approved = await api.approveRequest(request.id, 'approved', note || 'إذن حضور معتمد من نافذة المراجعة');
  if (approved.status !== 'approved') throw new Error('لم يؤكد الخادم اعتماد الإذن.');
  return { requestId: approved.id, minutes };
}
