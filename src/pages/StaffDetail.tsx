import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, MapPin, RefreshCw, UserRound } from 'lucide-react';
import StaffDetailLegacy from '@/pages/StaffDetailLegacy';
import EmploymentProfileTimeline from '@/components/hr/EmploymentProfileTimeline';
import StaffEmploymentRecords from '@/components/hr/StaffEmploymentRecords';
import { readStaffDirectory, type StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { getHREmployeeCore360V2, type HREmployeeCore360V2 } from '@/lib/hr/hrTruthService';

function formatShift(value?: string | null) {
  if (!value) return '—';
  return value.slice(0, 5);
}

export default function StaffDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const canWriteHR = ['general_manager', 'admin', 'executive_manager', 'branches_manager'].includes(role);
  const [staffOptions, setStaffOptions] = useState<StaffDirectoryIdentity[]>([]);
  const [truth, setTruth] = useState<HREmployeeCore360V2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    readStaffDirectory()
      .then((rows) => { if (active) setStaffOptions(rows.filter((row) => row.id && row.active)); })
      .catch(() => { if (active) setStaffOptions([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    getHREmployeeCore360V2(id)
      .then((data) => {
        if (!alive) return;
        setTruth(data);
        setAvailable(true);
      })
      .catch(() => {
        if (!alive) return;
        setTruth(null);
        setAvailable(false);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [id]);

  const qualityHealthy = truth
    ? truth.quality.has_schedule && truth.quality.branch_matches && truth.quality.legacy_shift_matches
    : false;

  return (
    <div className="space-y-4" dir="rtl">
      {available && (
        <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-primary-strong)]">
                <UserRound size={16} /> Employee 360 · HR Truth V2
              </div>
              <h1 className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">
                {truth?.staff.name || (loading ? 'جاري تحميل ملف الموظف…' : 'ملف الموظف')}
              </h1>
              <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                الهوية والفرع والجدول هنا من المصدر المركزي، ثم تظهر أسفلها تفاصيل الأداء والحوافز والسجل التشغيلي الحالي.
              </p>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]">
                <RefreshCw size={15} className="animate-spin" /> تحميل HR Truth
              </div>
            ) : truth ? (
              <div className={`rounded-full px-4 py-2 text-xs font-black ${
                qualityHealthy
                  ? 'bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'
                  : 'bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]'
              }`}>
                {qualityHealthy ? 'الملف متسق' : 'يحتاج مراجعة بيانات'}
              </div>
            ) : null}
          </div>

          {truth && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-[var(--dawaa-theme-surface-2)] p-4">
                  <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]"><UserRound size={15} /> الحالة الوظيفية</div>
                  <div className="mt-2 font-black text-[var(--dawaa-theme-heading)]">{truth.staff.role || truth.staff.type || 'غير محدد'}</div>
                  <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{truth.staff.active ? 'نشط' : 'مؤرشف'}</div>
                </div>
                <div className="rounded-2xl bg-[var(--dawaa-theme-surface-2)] p-4">
                  <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]"><MapPin size={15} /> الفرع المعتمد</div>
                  <div className="mt-2 font-black text-[var(--dawaa-theme-heading)]">{truth.staff.branch || 'غير محدد'}</div>
                  <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                    {truth.quality.branch_matches ? 'متطابق مع الجدول' : 'يوجد تعارض مع الجدول'}
                  </div>
                </div>
                <div className="rounded-2xl bg-[var(--dawaa-theme-surface-2)] p-4">
                  <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]"><CalendarClock size={15} /> جدول اليوم</div>
                  <div className="mt-2 font-black text-[var(--dawaa-theme-heading)]">
                    {truth.schedule
                      ? truth.schedule.is_off || truth.schedule.is_day_off
                        ? 'إجازة'
                        : `${formatShift(truth.schedule.shift_start)} ← ${formatShift(truth.schedule.shift_end)}`
                      : 'لا يوجد جدول'}
                  </div>
                  <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{truth.schedule?.source_kind || 'بدون مصدر'}</div>
                </div>
                <div className="rounded-2xl bg-[var(--dawaa-theme-surface-2)] p-4">
                  <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]">
                    {qualityHealthy ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} سلامة المصدر
                  </div>
                  <div className="mt-2 font-black text-[var(--dawaa-theme-heading)]">{qualityHealthy ? 'سليم' : 'يحتاج مراجعة'}</div>
                  <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                    {!truth.quality.has_schedule
                      ? 'لا يوجد جدول canonical'
                      : !truth.quality.branch_matches
                        ? 'تعارض فرع'
                        : !truth.quality.legacy_shift_matches
                          ? 'ساعات legacy مختلفة'
                          : 'لا توجد تعارضات'}
                  </div>
                </div>
              </div>

              {!qualityHealthy && (
                <div className="mt-3 rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
                  هذا تنبيه جودة بيانات فقط، ولا يتحول تلقائيًا إلى خطأ أو خصم على الموظف.
                </div>
              )}
            </>
          )}
        </section>
      )}

      {id && (
        <section className="grid gap-4 xl:grid-cols-2">
          <EmploymentProfileTimeline staffId={id} canWrite={canWriteHR} staffOptions={staffOptions} />
          <StaffEmploymentRecords staffId={id} canWrite={canWriteHR} />
        </section>
      )}

      <section>
        <div className="mb-2">
          <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">الأداء والتشغيل التاريخي</h2>
          <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
            هذا الجزء يعرض طبقة الأداء والحوافز والتفاصيل التشغيلية القديمة داخل Employee 360، بينما تبقى الهوية والجدول والسجل الوظيفي تحت HR Truth V2.
          </p>
        </div>
        <StaffDetailLegacy />
      </section>
    </div>
  );
}
