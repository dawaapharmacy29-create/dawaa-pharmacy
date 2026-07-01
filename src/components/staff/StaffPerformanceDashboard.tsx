import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Users,
  DollarSign,
  Package,
  AlertTriangle,
  Award,
  Calendar,
  ArrowRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { formatMoney } from '@/lib/dawaa2027';
import { loadStaffPerformanceProfile } from '@/lib/staff/staffPerformanceProfileService';
import type { StaffPerformanceProfile } from '@/lib/staff/staffPerformanceProfileService';
import { staffProfilePath } from '@/lib/staff/staffIdentityResolver';

interface StaffSummary {
  id: string;
  name: string;
  role: string;
  branch: string;
  finalPoints: number;
  incentiveValue: number;
  cycleNetSales: number;
  cycleInvoicesCount: number;
  uniqueCustomers: number;
  dataHealthScore: number;
}

export default function StaffPerformanceDashboard() {
  const [staffSummaries, setStaffSummaries] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'points' | 'sales' | 'customers' | 'health'>('points');

  useEffect(() => {
    async function loadDashboardData() {
      setLoading(true);
      try {
        // Get all active staff
        const { data: staff } = await supabase
          .from('staff')
          .select('id,name,role,branch')
          .eq('is_active', true)
          .limit(50);

        if (!staff || staff.length === 0) {
          setStaffSummaries([]);
          setLoading(false);
          return;
        }

        // Load performance profiles for each staff (with parallel loading)
        const profiles = await Promise.all(
          staff.map(async (s) => {
            try {
              const profile = await loadStaffPerformanceProfile({
                staffId: String(s.id),
                forceRefresh: true,
              });
              return {
                id: String(s.id),
                name: String(s.name || ''),
                role: String(s.role || ''),
                branch: String(s.branch || ''),
                finalPoints: profile.monthlyIncentive?.finalPoints || 0,
                incentiveValue: profile.monthlyIncentive?.incentiveValue || 0,
                cycleNetSales: profile.sales?.cycleNetSales || 0,
                cycleInvoicesCount: profile.sales?.cycleInvoicesCount || 0,
                uniqueCustomers: profile.sales?.uniqueCustomers || 0,
                dataHealthScore:
                  profile.dataHealth.warnings.length > 0
                    ? Math.max(0, 100 - profile.dataHealth.warnings.length * 10)
                    : 100,
              };
            } catch (error) {
              return {
                id: String(s.id),
                name: String(s.name || ''),
                role: String(s.role || ''),
                branch: String(s.branch || ''),
                finalPoints: 0,
                incentiveValue: 0,
                cycleNetSales: 0,
                cycleInvoicesCount: 0,
                uniqueCustomers: 0,
                dataHealthScore: 0,
              };
            }
          })
        );

        setStaffSummaries(profiles);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, []);

  // Filter by branch
  const filteredSummaries =
    selectedBranch === 'all'
      ? staffSummaries
      : staffSummaries.filter((s) => s.branch === selectedBranch);

  // Sort
  const sortedSummaries = [...filteredSummaries].sort((a, b) => {
    switch (sortBy) {
      case 'points':
        return b.finalPoints - a.finalPoints;
      case 'sales':
        return b.cycleNetSales - a.cycleNetSales;
      case 'customers':
        return b.uniqueCustomers - a.uniqueCustomers;
      case 'health':
        return b.dataHealthScore - a.dataHealthScore;
      default:
        return 0;
    }
  });

  // Get unique branches
  const branches = Array.from(new Set(staffSummaries.map((s) => s.branch))).filter(Boolean);

  // Calculate dashboard stats
  const totalStaff = staffSummaries.length;
  const totalSales = staffSummaries.reduce((sum, s) => sum + s.cycleNetSales, 0);
  const totalInvoices = staffSummaries.reduce((sum, s) => sum + s.cycleInvoicesCount, 0);
  const avgPoints =
    totalStaff > 0 ? staffSummaries.reduce((sum, s) => sum + s.finalPoints, 0) / totalStaff : 0;
  const lowHealthCount = staffSummaries.filter((s) => s.dataHealthScore < 70).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-slate-400">جاري تحميل لوحة الأداء...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">لوحة أداء الموظفين</h1>
        <p className="text-slate-400 text-sm mt-1">نظرة شاملة على أداء جميع الموظفين</p>
      </div>

      {/* Dashboard Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <DashboardCard label="عدد الموظفين" value={String(totalStaff)} icon={Users} color="teal" />
        <DashboardCard
          label="إجمالي المبيعات"
          value={formatMoney(totalSales)}
          icon={DollarSign}
          color="green"
        />
        <DashboardCard
          label="إجمالي الفواتير"
          value={formatNumber(totalInvoices)}
          icon={Package}
          color="blue"
        />
        <DashboardCard
          label="متوسط النقاط"
          value={formatNumber(avgPoints)}
          icon={Award}
          color="amber"
        />
        <DashboardCard
          label="تحذيرات البيانات"
          value={String(lowHealthCount)}
          icon={AlertTriangle}
          color="red"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-slate-400 text-sm">الفرع:</label>
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="bg-[#16253f] border border-[#2d4063] rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="all">جميع الفروع</option>
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-slate-400 text-sm">ترتيب حسب:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-[#16253f] border border-[#2d4063] rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="points">النقاط</option>
            <option value="sales">المبيعات</option>
            <option value="customers">العملاء</option>
            <option value="health">صحة البيانات</option>
          </select>
        </div>
      </div>

      {/* Staff Table */}
      <div className="stat-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-[#16253f] text-slate-300">
              <tr>
                <th className="p-3 text-right">الموظف</th>
                <th className="p-3 text-right">الفرع</th>
                <th className="p-3 text-right">النقاط</th>
                <th className="p-3 text-right">الحافز</th>
                <th className="p-3 text-right">المبيعات</th>
                <th className="p-3 text-right">الفواتير</th>
                <th className="p-3 text-right">العملاء</th>
                <th className="p-3 text-right">صحة البيانات</th>
                <th className="p-3 text-right">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {sortedSummaries.map((staff) => (
                <tr
                  key={staff.id}
                  className="border-t border-[#2d4063]/70 hover:bg-white/5 transition-colors"
                >
                  <td className="p-3">
                    <div className="text-white font-bold">{staff.name}</div>
                    <div className="text-slate-500 text-xs">{staff.role}</div>
                  </td>
                  <td className="p-3 text-slate-300">{staff.branch}</td>
                  <td className="p-3">
                    <span
                      className={`font-bold num ${
                        staff.finalPoints >= 450
                          ? 'text-teal-400'
                          : staff.finalPoints >= 350
                            ? 'text-amber-400'
                            : 'text-red-400'
                      }`}
                    >
                      {staff.finalPoints}
                    </span>
                  </td>
                  <td className="p-3 text-teal-300 num">{formatCurrency(staff.incentiveValue)}</td>
                  <td className="p-3 text-slate-300 num">{formatMoney(staff.cycleNetSales)}</td>
                  <td className="p-3 text-slate-300 num">
                    {formatNumber(staff.cycleInvoicesCount)}
                  </td>
                  <td className="p-3 text-slate-300 num">{formatNumber(staff.uniqueCustomers)}</td>
                  <td className="p-3">
                    <span
                      className={`font-bold num ${
                        staff.dataHealthScore >= 80
                          ? 'text-teal-400'
                          : staff.dataHealthScore >= 60
                            ? 'text-amber-400'
                            : 'text-red-400'
                      }`}
                    >
                      {staff.dataHealthScore.toFixed(0)}%
                    </span>
                  </td>
                  <td className="p-3">
                    <Link
                      to={staffProfilePath(staff)}
                      className="btn-secondary py-1 px-3 text-xs inline-flex items-center gap-1"
                    >
                      عرض <ArrowRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
              {sortedSummaries.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-500">
                    لا توجد بيانات
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Low Health Warning */}
      {lowHealthCount > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-400 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <div className="text-amber-200 font-bold text-sm mb-1">تحذير صحة البيانات</div>
              <p className="text-amber-100/90 text-xs">
                يوجد {lowHealthCount} موظف لديهم مشاكل في جودة البيانات. راجع ملفاتهم للحصول على
                التفاصيل.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: any;
  color: 'teal' | 'blue' | 'amber' | 'red' | 'green';
}) {
  const colorClasses = {
    teal: 'bg-teal-500/15 text-teal-400',
    blue: 'bg-blue-500/15 text-blue-400',
    amber: 'bg-amber-500/15 text-amber-400',
    red: 'bg-red-500/15 text-red-400',
    green: 'bg-green-500/15 text-green-400',
  };

  return (
    <div className="stat-card">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-xl ${colorClasses[color]} flex items-center justify-center`}
        >
          <Icon size={20} />
        </div>
        <div className="flex-1">
          <div className="text-slate-400 text-xs">{label}</div>
          <div className="text-white font-bold text-lg num">{value}</div>
        </div>
      </div>
    </div>
  );
}
