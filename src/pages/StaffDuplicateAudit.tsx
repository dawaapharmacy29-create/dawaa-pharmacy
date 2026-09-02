import { useState, useEffect } from 'react';
import {
  AlertCircle,
  Users,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  findStaffDuplicates,
  getDuplicateStatistics,
  type StaffDuplicateGroup,
  type StaffDuplicateRecord,
} from '@/lib/staffDuplicateAudit';
import { toast } from 'sonner';

export default function StaffDuplicateAudit() {
  const [loading, setLoading] = useState(true);
  const [statistics, setStatistics] = useState<any>(null);
  const [duplicateGroups, setDuplicateGroups] = useState<StaffDuplicateGroup[]>([]);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  useEffect(() => {
    loadDuplicates();
  }, []);

  const loadDuplicates = async () => {
    setLoading(true);
    try {
      const stats = await getDuplicateStatistics();
      setStatistics(stats);
      setDuplicateGroups(stats.duplicateGroups);
    } catch (error) {
      toast.error(`خطأ: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (normalizedName: string) => {
    setExpandedGroup(expandedGroup === normalizedName ? null : normalizedName);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--dawaa-status-info-text)]" />
      </div>
    );
  }

  return (
    <div className="dawaa-text p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">مراجعة ودمج الموظفين المكررين</h1>

      {/* إحصائيات */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="dawaa-surface rounded-lg shadow p-6">
          <div className="text-sm text-[var(--dawaa-theme-muted)]">إجمالي الموظفين</div>
          <div className="text-3xl font-bold">{statistics?.totalStaff || 0}</div>
        </div>
        <div className="dawaa-surface rounded-lg shadow p-6">
          <div className="text-sm text-[var(--dawaa-theme-muted)]">موظفين مكررين</div>
          <div className="text-3xl font-bold text-[var(--dawaa-status-danger-text)]">{statistics?.totalDuplicates || 0}</div>
        </div>
        <div className="dawaa-surface rounded-lg shadow p-6">
          <div className="text-sm text-[var(--dawaa-theme-muted)]">أسماء مكررة فريدة</div>
          <div className="text-3xl font-bold text-[var(--dawaa-status-warning-text)]">
            {statistics?.uniqueDuplicateNames || 0}
          </div>
        </div>
      </div>

      {duplicateGroups.length === 0 ? (
        <div className="bg-[var(--dawaa-status-success-bg)] border border-[var(--dawaa-status-success-border)] rounded-lg p-6 text-center">
          <CheckCircle className="w-12 h-12 text-[var(--dawaa-status-success-text)] mx-auto mb-4" />
          <div className="text-lg font-semibold text-[var(--dawaa-status-success-text)]">لا يوجد موظفين مكررين</div>
        </div>
      ) : (
        <div className="space-y-4">
          {duplicateGroups.map((group) => (
            <div key={group.normalized_name} className="dawaa-surface rounded-lg shadow overflow-hidden">
              <div
                className="p-4 cursor-pointer hover:bg-[var(--dawaa-theme-surface-2)] flex items-center justify-between"
                onClick={() => toggleGroup(group.normalized_name)}
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-[var(--dawaa-status-warning-text)]" />
                  <div>
                    <div className="font-semibold">{group.staff[0]?.display_name}</div>
                    <div className="text-sm text-[var(--dawaa-theme-muted)]">
                      {group.staff.length} سجل مكرر • {group.normalized_name}
                    </div>
                  </div>
                </div>
                {expandedGroup === group.normalized_name ? (
                  <ChevronUp className="w-5 h-5 text-[var(--dawaa-theme-muted)]" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-[var(--dawaa-theme-muted)]" />
                )}
              </div>

              {expandedGroup === group.normalized_name && (
                <div className="border-t p-4">
                  <div className="space-y-4">
                    {group.staff.map((staff) => (
                      <StaffRecordCard key={staff.staff_id} staff={staff} />
                    ))}
                  </div>

                  <div className="mt-4 pt-4 border-t flex gap-2">
                    <button className="px-4 py-2 dawaa-button dawaa-button--primary rounded">
                      دمج السجلات
                    </button>
                    <button className="px-4 py-2 dawaa-button dawaa-button--secondary rounded">
                      تعطيل التكرارات
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StaffRecordCard({ staff }: { staff: StaffDuplicateRecord }) {
  return (
    <div className="border rounded-lg p-4 dawaa-surface-soft">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">ID</div>
          <div className="font-semibold">{staff.staff_id.slice(0, 8)}...</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">الدور</div>
          <div className="font-semibold">{staff.role}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">الفرع</div>
          <div className="font-semibold">{staff.branch}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">الحالة</div>
          <div className="font-semibold">
            {staff.active ? (
              <span className="text-[var(--dawaa-status-success-text)]">نشط</span>
            ) : (
              <span className="text-[var(--dawaa-status-danger-text)]">غير نشط</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">فواتير</div>
          <div className="font-semibold">{staff.sales_invoice_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">ملخص المبيعات</div>
          <div className="font-semibold">{staff.staff_sales_summary_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">معاملات الموظف</div>
          <div className="font-semibold">{staff.employee_transactions_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">معاملات النقاط</div>
          <div className="font-semibold">{staff.points_transactions_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">سجلات النقاط</div>
          <div className="font-semibold">{staff.point_records_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">تقييمات المحادثات</div>
          <div className="font-semibold">{staff.conversation_reviews_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">المتابعات اليومية</div>
          <div className="font-semibold">{staff.daily_followups_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">جداول الشيفتات</div>
          <div className="font-semibold">{staff.shift_schedule_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">الحضور</div>
          <div className="font-semibold">{staff.attendance_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">الإذنات/الإجازات</div>
          <div className="font-semibold">{staff.time_off_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">سجلات الراكد</div>
          <div className="font-semibold">{staff.stagnant_list_records_count}</div>
        </div>
        <div>
          <div className="text-[var(--dawaa-theme-muted)]">تاريخ الإنشاء</div>
          <div className="font-semibold">
            {new Date(staff.created_at).toLocaleDateString('ar-EG')}
          </div>
        </div>
      </div>
    </div>
  );
}
