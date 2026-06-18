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
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">مراجعة ودمج الموظفين المكررين</h1>

      {/* إحصائيات */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-600">إجمالي الموظفين</div>
          <div className="text-3xl font-bold">{statistics?.totalStaff || 0}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-600">موظفين مكررين</div>
          <div className="text-3xl font-bold text-red-600">{statistics?.totalDuplicates || 0}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-600">أسماء مكررة فريدة</div>
          <div className="text-3xl font-bold text-orange-600">
            {statistics?.uniqueDuplicateNames || 0}
          </div>
        </div>
      </div>

      {duplicateGroups.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
          <div className="text-lg font-semibold text-green-800">لا يوجد موظفين مكررين</div>
        </div>
      ) : (
        <div className="space-y-4">
          {duplicateGroups.map((group) => (
            <div key={group.normalized_name} className="bg-white rounded-lg shadow overflow-hidden">
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 flex items-center justify-between"
                onClick={() => toggleGroup(group.normalized_name)}
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-orange-500" />
                  <div>
                    <div className="font-semibold">{group.staff[0]?.display_name}</div>
                    <div className="text-sm text-gray-600">
                      {group.staff.length} سجل مكرر • {group.normalized_name}
                    </div>
                  </div>
                </div>
                {expandedGroup === group.normalized_name ? (
                  <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
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
                    <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                      دمج السجلات
                    </button>
                    <button className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
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
    <div className="border rounded-lg p-4 bg-gray-50">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-gray-600">ID</div>
          <div className="font-semibold">{staff.staff_id.slice(0, 8)}...</div>
        </div>
        <div>
          <div className="text-gray-600">الدور</div>
          <div className="font-semibold">{staff.role}</div>
        </div>
        <div>
          <div className="text-gray-600">الفرع</div>
          <div className="font-semibold">{staff.branch}</div>
        </div>
        <div>
          <div className="text-gray-600">الحالة</div>
          <div className="font-semibold">
            {staff.active ? (
              <span className="text-green-600">نشط</span>
            ) : (
              <span className="text-red-600">غير نشط</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-gray-600">فواتير</div>
          <div className="font-semibold">{staff.sales_invoice_count}</div>
        </div>
        <div>
          <div className="text-gray-600">ملخص المبيعات</div>
          <div className="font-semibold">{staff.staff_sales_summary_count}</div>
        </div>
        <div>
          <div className="text-gray-600">معاملات الموظف</div>
          <div className="font-semibold">{staff.employee_transactions_count}</div>
        </div>
        <div>
          <div className="text-gray-600">معاملات النقاط</div>
          <div className="font-semibold">{staff.points_transactions_count}</div>
        </div>
        <div>
          <div className="text-gray-600">سجلات النقاط</div>
          <div className="font-semibold">{staff.point_records_count}</div>
        </div>
        <div>
          <div className="text-gray-600">تقييمات المحادثات</div>
          <div className="font-semibold">{staff.conversation_reviews_count}</div>
        </div>
        <div>
          <div className="text-gray-600">المتابعات اليومية</div>
          <div className="font-semibold">{staff.daily_followups_count}</div>
        </div>
        <div>
          <div className="text-gray-600">جداول الشيفتات</div>
          <div className="font-semibold">{staff.shift_schedule_count}</div>
        </div>
        <div>
          <div className="text-gray-600">الحضور</div>
          <div className="font-semibold">{staff.attendance_count}</div>
        </div>
        <div>
          <div className="text-gray-600">الإذنات/الإجازات</div>
          <div className="font-semibold">{staff.time_off_count}</div>
        </div>
        <div>
          <div className="text-gray-600">سجلات الراكد</div>
          <div className="font-semibold">{staff.stagnant_list_records_count}</div>
        </div>
        <div>
          <div className="text-gray-600">تاريخ الإنشاء</div>
          <div className="font-semibold">
            {new Date(staff.created_at).toLocaleDateString('ar-EG')}
          </div>
        </div>
      </div>
    </div>
  );
}
