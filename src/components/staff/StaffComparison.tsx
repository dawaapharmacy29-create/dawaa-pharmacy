import { useState } from "react";
import { X, Plus, TrendingUp, Users, DollarSign, Award, Calendar } from "lucide-react";
import { loadStaffPerformanceProfile } from "@/lib/staff/staffPerformanceProfileService";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { formatMoney } from "@/lib/dawaa2027";
import type { StaffPerformanceProfile } from "@/lib/staff/staffPerformanceProfileService";

interface StaffComparisonProps {
  initialStaffIds?: string[];
  onClose?: () => void;
}

export default function StaffComparison({ initialStaffIds = [], onClose }: StaffComparisonProps) {
  const [staffIds, setStaffIds] = useState<string[]>(initialStaffIds);
  const [profiles, setProfiles] = useState<Map<string, StaffPerformanceProfile>>(new Map());
  const [loading, setLoading] = useState(false);
  const [newStaffId, setNewStaffId] = useState("");

  const loadProfile = async (staffId: string) => {
    if (profiles.has(staffId)) return;
    
    setLoading(true);
    try {
      const profile = await loadStaffPerformanceProfile({ staffId, forceRefresh: true });
      setProfiles((prev) => new Map(prev).set(staffId, profile));
    } catch (error) {
      console.error("Error loading staff profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const addStaff = () => {
    if (newStaffId && !staffIds.includes(newStaffId)) {
      setStaffIds([...staffIds, newStaffId]);
      loadProfile(newStaffId);
      setNewStaffId("");
    }
  };

  const removeStaff = (staffId: string) => {
    setStaffIds(staffIds.filter((id) => id !== staffId));
    setProfiles((prev) => {
      const next = new Map(prev);
      next.delete(staffId);
      return next;
    });
  };

  // Load initial profiles
  useState(() => {
    initialStaffIds.forEach((id) => loadProfile(id));
  });

  const staffProfiles = staffIds.map((id) => profiles.get(id)).filter((p): p is StaffPerformanceProfile => p !== undefined);

  if (staffProfiles.length === 0) {
    return (
      <div className="stat-card p-8 text-center">
        <div className="text-slate-400 mb-4">أضف موظفين للمقارنة</div>
        <div className="flex gap-2 justify-center">
          <input
            type="text"
            value={newStaffId}
            onChange={(e) => setNewStaffId(e.target.value)}
            placeholder="معرف الموظف"
            className="bg-[#16253f] border border-[#2d4063] rounded-lg px-3 py-2 text-white text-sm"
          />
          <button onClick={addStaff} className="btn-primary px-4 py-2 text-sm">
            <Plus size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">مقارنة الموظفين</h2>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        )}
      </div>

      {/* Add Staff Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newStaffId}
          onChange={(e) => setNewStaffId(e.target.value)}
          placeholder="معرف الموظف للمقارنة"
          className="flex-1 bg-[#16253f] border border-[#2d4063] rounded-lg px-3 py-2 text-white text-sm"
        />
        <button onClick={addStaff} className="btn-primary px-4 py-2 text-sm">
          <Plus size={16} />
          إضافة موظف
        </button>
      </div>

      {/* Comparison Table */}
      <div className="stat-card overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-[#16253f] text-slate-300">
            <tr>
              <th className="p-3 text-right">المقياس</th>
              {staffProfiles.map((profile) => (
                <th key={profile.staff.id} className="p-3 text-center">
                  <div className="font-bold">{profile.staff.name}</div>
                  <div className="text-xs text-slate-500">{profile.staff.role}</div>
                  <button
                    onClick={() => removeStaff(profile.staff.id)}
                    className="text-red-400 hover:text-red-300 mt-1"
                  >
                    <X size={14} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Sales Metrics */}
            <tr className="border-t border-[#2d4063]/70">
              <td className="p-3 text-slate-300 flex items-center gap-2">
                <DollarSign size={16} className="text-teal-400" />
                مبيعات الدورة
              </td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.sales ? formatMoney(profile.sales.cycleNetSales) : "-"}
                </td>
              ))}
            </tr>
            <tr className="border-t border-[#2d4063]/70">
              <td className="p-3 text-slate-300">عدد الفواتير</td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.sales ? formatNumber(profile.sales.cycleInvoicesCount) : "-"}
                </td>
              ))}
            </tr>
            <tr className="border-t border-[#2d4063]/70">
              <td className="p-3 text-slate-300">متوسط الفاتورة</td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.sales ? formatCurrency(profile.sales.avgInvoice) : "-"}
                </td>
              ))}
            </tr>

            {/* Customer Metrics */}
            <tr className="border-t border-[#2d4063]/70 bg-white/5">
              <td className="p-3 text-slate-300 flex items-center gap-2">
                <Users size={16} className="text-blue-400" />
                عملاء مختلفون
              </td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.sales ? formatNumber(profile.sales.uniqueCustomers) : "-"}
                </td>
              ))}
            </tr>
            <tr className="border-t border-[#2d4063]/70">
              <td className="p-3 text-slate-300">عملاء جدد</td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.customers ? formatNumber(profile.customers.newCustomers) : "-"}
                </td>
              ))}
            </tr>

            {/* Incentive Metrics */}
            <tr className="border-t border-[#2d4063]/70 bg-white/5">
              <td className="p-3 text-slate-300 flex items-center gap-2">
                <Award size={16} className="text-amber-400" />
                النقاط النهائية
              </td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.monthlyIncentive ? formatNumber(profile.monthlyIncentive.finalPoints) : "-"}
                </td>
              ))}
            </tr>
            <tr className="border-t border-[#2d4063]/70">
              <td className="p-3 text-slate-300">قيمة الحافز</td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.monthlyIncentive ? formatCurrency(profile.monthlyIncentive.incentiveValue) : "-"}
                </td>
              ))}
            </tr>

            {/* Quarterly Metrics */}
            <tr className="border-t border-[#2d4063]/70 bg-white/5">
              <td className="p-3 text-slate-300 flex items-center gap-2">
                <Calendar size={16} className="text-purple-400" />
                النتيجة الربع سنوية
              </td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.quarterlyIncentive ? `${profile.quarterlyIncentive.quarterlyScore}/100` : "-"}
                </td>
              ))}
            </tr>
            <tr className="border-t border-[#2d4063]/70">
              <td className="p-3 text-slate-300">القيمة الربع سنوية</td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.quarterlyIncentive ? formatCurrency(profile.quarterlyIncentive.quarterlyFinalValue) : "-"}
                </td>
              ))}
            </tr>

            {/* Attendance Metrics */}
            <tr className="border-t border-[#2d4063]/70 bg-white/5">
              <td className="p-3 text-slate-300 flex items-center gap-2">
                <TrendingUp size={16} className="text-green-400" />
                نسبة الالتزام
              </td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.attendance ? `${profile.attendance.attendanceCompliance.toFixed(0)}%` : "-"}
                </td>
              ))}
            </tr>
            <tr className="border-t border-[#2d4063]/70">
              <td className="p-3 text-slate-300">التأخيرات</td>
              {staffProfiles.map((profile) => (
                <td key={profile.staff.id} className="p-3 text-center num">
                  {profile.attendance ? formatNumber(profile.attendance.delays) : "-"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Performance Summary */}
      <div className="grid md:grid-cols-3 gap-4">
        {staffProfiles.map((profile) => (
          <div key={profile.staff.id} className="stat-card">
            <div className="font-bold text-white mb-2">{profile.staff.name}</div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">النقاط</span>
                <span className="text-white num">
                  {profile.monthlyIncentive ? formatNumber(profile.monthlyIncentive.finalPoints) : "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">المبيعات</span>
                <span className="text-white num">
                  {profile.sales ? formatMoney(profile.sales.cycleNetSales) : "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">العملاء</span>
                <span className="text-white num">
                  {profile.sales ? formatNumber(profile.sales.uniqueCustomers) : "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">ربع سنوي</span>
                <span className="text-white num">
                  {profile.quarterlyIncentive ? formatCurrency(profile.quarterlyIncentive.quarterlyFinalValue) : "-"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
