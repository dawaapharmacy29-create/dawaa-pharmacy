import { useMemo } from "react";
import { Users, TrendingUp, CheckCircle2, PhoneCall, DollarSign, Award, AlertCircle } from "lucide-react";
import type { DailyFollowup } from "@/types/database";

interface StaffChoice {
  id: string;
  name: string;
  role: string;
  branch: string;
}

interface TeamPerformanceAnalyticsProps {
  followups: DailyFollowup[];
  staff: StaffChoice[];
}

interface StaffPerformance {
  id: string;
  name: string;
  branch: string;
  totalFollowups: number;
  completedFollowups: number;
  pendingFollowups: number;
  completionRate: number;
  totalPurchaseAmount: number;
  avgQualityRating: number;
  customerSatisfactionRate: number;
}

export default function TeamPerformanceAnalytics({ followups, staff }: TeamPerformanceAnalyticsProps) {
  const staffPerformance = useMemo(() => {
    const performance: Record<string, StaffPerformance> = {};

    // Initialize performance for all staff
    staff.forEach((person) => {
      performance[person.name] = {
        id: person.id,
        name: person.name,
        branch: person.branch || "غير محدد",
        totalFollowups: 0,
        completedFollowups: 0,
        pendingFollowups: 0,
        completionRate: 0,
        totalPurchaseAmount: 0,
        avgQualityRating: 0,
        customerSatisfactionRate: 0,
      };
    });

    // Calculate metrics from followups
    followups.forEach((followup) => {
      const assignedTo = followup.assigned_to || followup.responsible_name;
      if (!assignedTo || !performance[assignedTo]) return;

      const perf = performance[assignedTo];
      perf.totalFollowups++;

      const isCompleted = followup.status && 
        !["معلق", "pending", "لم يرد"].includes(followup.status);
      
      if (isCompleted) {
        perf.completedFollowups++;
        perf.totalPurchaseAmount += Number(followup.purchase_amount || 0);
        
        // Extract quality rating from notes if available
        const qualityMatch = followup.notes?.match(/تقييم الجودة:\s*(\d+)/);
        if (qualityMatch) {
          const rating = parseInt(qualityMatch[1], 10);
          perf.avgQualityRating = (perf.avgQualityRating * (perf.completedFollowups - 1) + rating) / perf.completedFollowups;
        }
        
        // Check customer satisfaction
        if (followup.notes?.includes("العميل راضي: نعم")) {
          perf.customerSatisfactionRate = 
            (perf.customerSatisfactionRate * (perf.completedFollowups - 1) + 1) / perf.completedFollowups;
        }
      } else {
        perf.pendingFollowups++;
      }
    });

    // Calculate completion rates
    Object.values(performance).forEach((perf) => {
      perf.completionRate = perf.totalFollowups > 0 
        ? (perf.completedFollowups / perf.totalFollowups) * 100 
        : 0;
    });

    return Object.values(performance).sort((a, b) => b.completionRate - a.completionRate);
  }, [followups, staff]);

  const teamStats = useMemo(() => {
    const totalFollowups = followups.length;
    const completed = followups.filter((f) => 
      f.status && !["معلق", "pending", "لم يرد"].includes(f.status)
    ).length;
    const totalPurchaseAmount = followups.reduce((sum, f) => sum + Number(f.purchase_amount || 0), 0);
    const avgCompletionRate = staffPerformance.length > 0
      ? staffPerformance.reduce((sum, p) => sum + p.completionRate, 0) / staffPerformance.length
      : 0;

    return {
      totalFollowups,
      completed,
      pending: totalFollowups - completed,
      totalPurchaseAmount,
      avgCompletionRate,
      teamSize: staffPerformance.length,
    };
  }, [followups, staffPerformance]);

  const getPerformanceColor = (rate: number) => {
    if (rate >= 80) return "text-green-400";
    if (rate >= 60) return "text-teal-400";
    if (rate >= 40) return "text-amber-400";
    return "text-red-400";
  };

  const getPerformanceBadge = (rate: number) => {
    if (rate >= 90) return { label: "ممتاز", color: "bg-green-500/20 text-green-300 border-green-400/30" };
    if (rate >= 75) return { label: "جيد جداً", color: "bg-teal-500/20 text-teal-300 border-teal-400/30" };
    if (rate >= 60) return { label: "جيد", color: "bg-blue-500/20 text-blue-300 border-blue-400/30" };
    if (rate >= 40) return { label: "متوسط", color: "bg-amber-500/20 text-amber-300 border-amber-400/30" };
    return { label: "يحتاج تحسين", color: "bg-red-500/20 text-red-300 border-red-400/30" };
  };

  return (
    <div className="space-y-4">
      {/* Team Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <Users size={14} /> حجم الفريق
          </div>
          <div className="text-2xl font-bold text-white">{teamStats.teamSize}</div>
        </div>
        <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <CheckCircle2 size={14} /> معدل الإنجاز
          </div>
          <div className={`text-2xl font-bold ${getPerformanceColor(teamStats.avgCompletionRate)}`}>
            {teamStats.avgCompletionRate.toFixed(1)}%
          </div>
        </div>
        <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <DollarSign size={14} /> إجمالي المبيعات
          </div>
          <div className="text-2xl font-bold text-teal-300">
            {Math.round(teamStats.totalPurchaseAmount).toLocaleString("ar-EG")} ج
          </div>
        </div>
        <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <TrendingUp size={14} /> المتابعات المكتملة
          </div>
          <div className="text-2xl font-bold text-green-400">
            {teamStats.completed}/{teamStats.totalFollowups}
          </div>
        </div>
      </div>

      {/* Individual Staff Performance */}
      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
        <div className="section-title flex items-center gap-2 mb-4">
          <Award size={20} className="text-teal-300" /> أداء الفريق الفردي
        </div>
        
        <div className="space-y-3">
          {staffPerformance.length === 0 ? (
            <div className="text-center text-slate-400 py-8">
              لا توجد بيانات أداء متاحة
            </div>
          ) : (
            staffPerformance.map((perf) => {
              const badge = getPerformanceBadge(perf.completionRate);
              return (
                <div
                  key={perf.id}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-teal-400/30 transition-colors"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-white font-medium">{perf.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded border ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">{perf.branch}</div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-slate-400 text-xs">الإنجاز</div>
                        <div className={`text-lg font-bold ${getPerformanceColor(perf.completionRate)}`}>
                          {perf.completionRate.toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs">المبيعات</div>
                        <div className="text-lg font-bold text-teal-300">
                          {Math.round(perf.totalPurchaseAmount).toLocaleString("ar-EG")} ج
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs">التقييم</div>
                        <div className="text-lg font-bold text-yellow-400">
                          {perf.avgQualityRating > 0 ? perf.avgQualityRating.toFixed(1) : "-"}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>المكتملة: {perf.completedFollowups}</span>
                      <span>المعلقة: {perf.pendingFollowups}</span>
                      <span>الإجمالي: {perf.totalFollowups}</span>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          perf.completionRate >= 80 ? 'bg-green-500' :
                          perf.completionRate >= 60 ? 'bg-teal-500' :
                          perf.completionRate >= 40 ? 'bg-amber-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${perf.completionRate}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Performance Insights */}
      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
        <div className="section-title flex items-center gap-2 mb-4">
          <AlertCircle size={20} className="text-amber-300" /> رؤى الأداء
        </div>
        
        <div className="grid gap-3 md:grid-cols-2">
          {staffPerformance.length > 0 && (
            <>
              <div className="bg-green-500/10 border border-green-400/20 rounded-xl p-4">
                <div className="text-green-300 font-medium text-sm mb-1">أفضل أداء</div>
                <div className="text-white font-bold">{staffPerformance[0].name}</div>
                <div className="text-slate-400 text-xs mt-1">
                  معدل إنجاز: {staffPerformance[0].completionRate.toFixed(1)}% | 
                  مبيعات: {Math.round(staffPerformance[0].totalPurchaseAmount).toLocaleString("ar-EG")} ج
                </div>
              </div>
              
              {staffPerformance.length > 1 && (
                <div className="bg-amber-500/10 border border-amber-400/20 rounded-xl p-4">
                  <div className="text-amber-300 font-medium text-sm mb-1">يحتاج دعم</div>
                  <div className="text-white font-bold">
                    {staffPerformance[staffPerformance.length - 1].name}
                  </div>
                  <div className="text-slate-400 text-xs mt-1">
                    معدل إنجاز: {staffPerformance[staffPerformance.length - 1].completionRate.toFixed(1)}% | 
                    متابعة معلقة: {staffPerformance[staffPerformance.length - 1].pendingFollowups}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
