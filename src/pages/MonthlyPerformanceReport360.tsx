import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { getEvaluationCycle } from '@/lib/evaluationCycle';
import { useAuth } from '@/hooks/useAuth';
import { generateUnifiedMonthlyReport } from '@/lib/reports/unifiedMonthlyReportEngine';
import { generateMonthlyReportPDF } from '@/lib/reports/monthlyReportPDFGenerator';
import { generateMonthlyReportExcel } from '@/lib/reports/monthlyReportExcelGenerator';
import { 
  Download, FileText, Users, TrendingUp, AlertCircle, 
  Calendar, CheckCircle, Clock, Target, Award, Activity, 
  Briefcase, CheckSquare, XCircle, Star, AlertTriangle, User
} from 'lucide-react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';

interface UnifiedMonthlyReport {
  employee: { id: string; name: string; role: string; branch: string; joinDate?: string };
  cycle: { start: Date; end: Date; label: string };
  sales: {
    totalSales: number; invoicesCount: number; avgInvoice: number;
    basketSize: number; branchAvgInvoice: number; diffPercent: number;
    uniqueCustomers: number; newCustomers: number;
    returnsCount: number; returnsRate: number;
    peakHours: { hour: number; count: number }[];
    dailyBreakdown: { date: string; sales: number; invoices: number }[];
    shiftBreakdown: { shift: string; sales: number; invoices: number }[];
    bestDay: { date: string; sales: number };
    worstDay: { date: string; sales: number };
  };
  customers: {
    totalLinked: number; newThisCycle: number; repeatPurchaseRate: number;
    withoutPhone: number; withoutPhonePercent: number;
    topCustomers: { name: string; spending: number; visits: number }[];
  };
  monthlyIncentive: {
    startingPoints: number; totalRewards: number; totalDeductions: number;
    netPoints: number; excelPoints: number;
    incentiveEGP: number; maxIncentiveEGP: number; progressPercent: number;
    transactions: { title: string; points: number; date: string; source: string; type: 'reward' | 'deduction'; createdBy?: string; approvedBy?: string }[];
  };
  pillars: { pillar: string; score: number; maxScore: number; percentage: number; details: string[]; breakdown: { label: string; earned: number; max: number }[] }[];
  attendance: {
    scheduledDays: number; presentDays: number; absentDays: number;
    lateDays: number; attendanceRate: number;
    permissionsUsed: number; freePermissionsLeft: number;
  };
  dailyTasks: { totalTasks: number; completedTasks: number; lateTasks: number; completionRate: number };
  shiftPerformance: {
    totalReviews: number; issuesAsLeader: number; issuesAsMember: number;
    totalDeductionPoints: number; commonIssues: { issue: string; count: number }[];
  };
  stagnantAndList: {
    assignedItems: number; soldItems: number; completionRate: number;
    cashRewardsEGP: number; nearExpiryItems: number;
  };
  managerEvaluation?: {
    overallScore: number; grade: string;
    axisScores: { axis: string; weight: number; score: number }[];
    strengths: string[]; improvements: string[];
    managerNotes: string; nextMonthPlan: string;
  };
  financialSummary: {
    monthlyIncentiveEGP: number; evaluationIncentiveEGP: number;
    stagnantRewardsEGP: number; totalRewardsEGP: number;
    totalDeductionsEGP: number; netPayableEGP: number;
  };
  historicalTrend: {
    months: { label: string; sales: number; points: number; attendanceRate: number; taskCompletionRate: number }[];
  };
  recommendations: { priority: 'high' | 'medium' | 'low'; category: string; message: string; actionable: string }[];
  overallScore: { score: number; grade: string; gradeColor: string; breakdown: { label: string; weight: number; score: number; weightedScore: number }[] };
  errors: string[];
}

const COLORS = ['#14b8a6', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function MonthlyPerformanceReport360() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(searchParams.get('staffId') || '');
  const [selectedCycle, setSelectedCycle] = useState<string>(searchParams.get('cycle') || '');
  const [cycles, setCycles] = useState<{ label: string; start: string; end: string }[]>([]);
  
  const [reportData, setReportData] = useState<UnifiedMonthlyReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('overview');
  
  // Initialize cycles (current + last 6)
  useEffect(() => {
    const today = new Date();
    const generatedCycles = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, today.getDate());
      const cycleInfo = getEvaluationCycle(d);
      const val = cycleInfo.start.toISOString().split('T')[0];
      generatedCycles.push({
        label: cycleInfo.label,
        start: val,
        end: cycleInfo.end.toISOString().split('T')[0]
      });
    }
    setCycles(generatedCycles);
    if (!selectedCycle && generatedCycles.length > 0) {
      setSelectedCycle(generatedCycles[0].start);
    }
  }, []);

  // Fetch staff
  useEffect(() => {
    const fetchStaff = async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('name');
        
      if (!error && data) {
        setStaff(data);
        if (!selectedStaffId && data.length > 0) {
          setSelectedStaffId(data[0].id);
        }
      }
    };
    fetchStaff();
  }, []);

  // Sync state with URL params
  useEffect(() => {
    const newParams = new URLSearchParams();
    if (selectedStaffId) newParams.set('staffId', selectedStaffId);
    if (selectedCycle) newParams.set('cycle', selectedCycle);
    setSearchParams(newParams, { replace: true });
  }, [selectedStaffId, selectedCycle, setSearchParams]);

  // Load report data
  useEffect(() => {
    const loadData = async () => {
      if (!selectedStaffId || !selectedCycle) return;
      setLoading(true);
      try {
        const cycleDate = new Date(selectedCycle);
        const data = await generateUnifiedMonthlyReport(selectedStaffId, cycleDate);
        setReportData(data);
      } catch (err) {
        console.error("Failed to load report", err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedStaffId, selectedCycle]);

  const handleExportPDF = async () => {
    if (!reportData) return;
    try {
      await generateMonthlyReportPDF(reportData);
    } catch (err) {
      console.error("PDF generation failed", err);
    }
  };

  const handleExportExcel = async () => {
    if (!reportData) return;
    try {
      await generateMonthlyReportExcel(reportData);
    } catch (err) {
      console.error("Excel generation failed", err);
    }
  };

  const isManager = user?.role === 'manager' || user?.role === 'branch_manager' || user?.role === 'admin';

  return (
    <div className="p-6 space-y-6 bg-[#06131f] min-h-screen text-slate-200" dir="rtl">
      
      {/* Header section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#0b1d31] p-4 rounded-xl border border-slate-700 shadow-md">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="h-6 w-6 text-teal-400" />
            تقرير الأداء الشهري الشامل 360°
          </h1>
          <p className="text-slate-400 text-sm mt-1">عرض تفصيلي لأداء الموظف والمؤشرات الرئيسية</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-slate-400" />
            <select
              className="bg-[#112a46] border border-slate-600 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 min-w-[150px]"
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
            >
              <option value="" disabled>اختر الموظف...</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-400" />
            <select
              className="bg-[#112a46] border border-slate-600 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 min-w-[150px]"
              value={selectedCycle}
              onChange={(e) => setSelectedCycle(e.target.value)}
            >
              {cycles.map(c => <option key={c.start} value={c.start}>{c.label}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2 border-r border-slate-600 pr-3 mr-1">
            <button
              onClick={handleExportPDF}
              disabled={!reportData || loading}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm transition-colors"
            >
              <FileText className="h-4 w-4" />
              PDF
            </button>
            <button
              onClick={handleExportExcel}
              disabled={!reportData || loading}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm transition-colors"
            >
              <Download className="h-4 w-4" />
              Excel
            </button>
            {isManager && (
              <button
                disabled={loading}
                className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm transition-colors"
              >
                <Users className="h-4 w-4" />
                تصدير تقارير الفرع
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-[#0b1d31] h-40 rounded-xl border border-slate-700"></div>
          ))}
        </div>
      ) : !reportData ? (
        <div className="bg-[#0b1d31] p-12 rounded-xl border border-slate-700 text-center text-slate-400">
          يرجى اختيار الموظف والدورة لعرض التقرير
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* Main Content Tabs */}
          <div className="flex overflow-x-auto gap-2 bg-[#0b1d31] p-1 rounded-xl border border-slate-700 hide-scrollbar">
            {[
              { id: 'overview', label: 'الملخص', icon: Target },
              { id: 'sales', label: 'المبيعات', icon: TrendingUp },
              { id: 'incentives', label: 'الحوافز', icon: Award },
              { id: 'attendance', label: 'الحضور والمهام', icon: Clock },
              { id: 'history', label: 'التطور التاريخي', icon: Activity },
              { id: 'recommendations', label: 'التوصيات', icon: Star },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg whitespace-nowrap transition-colors text-sm font-medium ${
                  activeTab === tab.id 
                    ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          <div className="min-h-[500px]">
            {activeTab === 'overview' && <OverviewTab reportData={reportData} />}
            {activeTab === 'sales' && <SalesTab reportData={reportData} />}
            {activeTab === 'incentives' && <IncentivesTab reportData={reportData} />}
            {activeTab === 'attendance' && <AttendanceTab reportData={reportData} />}
            {activeTab === 'history' && <HistoryTab reportData={reportData} />}
            {activeTab === 'recommendations' && <RecommendationsTab reportData={reportData} />}
          </div>

        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Sub-components for tabs
// -------------------------------------------------------------

function OverviewTab({ reportData }: { reportData: UnifiedMonthlyReport }) {
  const { overallScore, pillars, sales, monthlyIncentive, attendance, financialSummary } = reportData;
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (overallScore.score / 100) * circumference;

  const radarData = pillars.map(p => ({
    subject: p.pillar,
    A: p.percentage,
    fullMark: 100,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* Top Left: Score Gauge */}
      <div className="bg-[#0b1d31] p-6 rounded-xl border border-slate-700 flex flex-col items-center justify-center relative">
        <h3 className="text-lg font-bold text-white mb-6">التقييم العام</h3>
        <div className="relative flex items-center justify-center">
          <svg width="180" height="180" className="transform -rotate-90">
            <circle cx="90" cy="90" r={radius} stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-800" />
            <circle 
              cx="90" cy="90" r={radius} stroke="currentColor" strokeWidth="12" fill="transparent" 
              className={overallScore.gradeColor}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-4xl font-bold text-white">{overallScore.score.toFixed(1)}<span className="text-xl text-slate-400">%</span></span>
          </div>
        </div>
        <div className={`mt-6 px-6 py-2 rounded-full border text-lg font-bold ${overallScore.gradeColor.replace('text-', 'bg-').replace('500', '500/10')} ${overallScore.gradeColor.replace('text-', 'border-').replace('500', '500/30')} ${overallScore.gradeColor}`}>
          {overallScore.grade}
        </div>
      </div>

      {/* Top Right: Radar Chart */}
      <div className="bg-[#0b1d31] p-6 rounded-xl border border-slate-700 lg:col-span-2">
        <h3 className="text-lg font-bold text-white mb-4">تحليل محاور التقييم (360°)</h3>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
              <PolarGrid stroke="#334155" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#cbd5e1', fontSize: 12 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#64748b' }} />
              <Radar name="النتيجة" dataKey="A" stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.4} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom: KPI Cards */}
      <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="إجمالي المبيعات" value={`${sales.totalSales.toLocaleString()} ج.م`} icon={TrendingUp} color="text-teal-400" />
        <KpiCard title="نقاط الحوافز الصافية" value={monthlyIncentive.netPoints} icon={Award} color="text-amber-400" />
        <KpiCard title="معدل الحضور" value={`${attendance.attendanceRate}%`} icon={Clock} color="text-blue-400" />
        <KpiCard title="إجمالي المستحق" value={`${financialSummary.netPayableEGP.toLocaleString()} ج.م`} icon={Briefcase} color="text-emerald-400" />
      </div>
    </div>
  );
}

function SalesTab({ reportData }: { reportData: UnifiedMonthlyReport }) {
  const { sales } = reportData;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="إجمالي المبيعات" value={`${sales.totalSales.toLocaleString()} ج.م`} icon={TrendingUp} color="text-teal-400" />
        <KpiCard title="عدد الفواتير" value={sales.invoicesCount} icon={FileText} color="text-blue-400" />
        <KpiCard title="متوسط الفاتورة" value={`${sales.avgInvoice.toLocaleString()} ج.م`} icon={Activity} color="text-amber-400" />
        <KpiCard title="حجم السلة" value={`${sales.basketSize.toFixed(1)} قطعة`} icon={Target} color="text-purple-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0b1d31] p-6 rounded-xl border border-slate-700">
          <h3 className="text-lg font-bold text-white mb-4">المبيعات اليومية</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sales.dailyBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickFormatter={(val) => val.substring(8,10)} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
                <Bar dataKey="sales" name="المبيعات" fill="#14b8a6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#0b1d31] p-6 rounded-xl border border-slate-700">
          <h3 className="text-lg font-bold text-white mb-4">مبيعات الورديات</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={sales.shiftBreakdown} dataKey="sales" nameKey="shift" cx="50%" cy="50%" innerRadius={60} outerRadius={100} label>
                  {sales.shiftBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function IncentivesTab({ reportData }: { reportData: UnifiedMonthlyReport }) {
  const { monthlyIncentive } = reportData;
  const rewards = monthlyIncentive.transactions.filter(t => t.type === 'reward');
  const deductions = monthlyIncentive.transactions.filter(t => t.type === 'deduction');

  return (
    <div className="space-y-6">
      <div className="bg-[#0b1d31] p-6 rounded-xl border border-slate-700">
        <h3 className="text-lg font-bold text-white mb-4">موقف النقاط والحوافز</h3>
        <div className="flex flex-col md:flex-row gap-8 items-center">
          <div className="flex-1 w-full space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">النقاط الحالية: <strong className="text-white">{monthlyIncentive.netPoints}</strong></span>
              <span className="text-slate-400">الهدف: <strong className="text-white">500</strong></span>
            </div>
            <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-l from-teal-400 to-emerald-500 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min(100, Math.max(0, monthlyIncentive.progressPercent))}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 text-center mt-2">نسبة تحقيق الهدف المستهدف للحوافز المالية</p>
          </div>
          <div className="flex flex-col items-center justify-center min-w-[150px] p-4 bg-slate-800/50 rounded-lg border border-slate-700">
            <span className="text-sm text-slate-400">قيمة الحافز</span>
            <span className="text-2xl font-bold text-amber-400">{monthlyIncentive.incentiveEGP.toLocaleString()} ج.م</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Rewards Table */}
        <div className="bg-[#0b1d31] rounded-xl border border-slate-700 overflow-hidden flex flex-col h-[400px]">
          <div className="p-4 border-b border-slate-700 bg-teal-900/20">
            <h3 className="font-bold text-teal-400 flex items-center gap-2"><Award className="h-5 w-5" /> سجل المكافآت</h3>
          </div>
          <div className="overflow-y-auto flex-1 p-0">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-800 text-slate-400 sticky top-0">
                <tr>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">السبب</th>
                  <th className="px-4 py-3 font-medium">النقاط</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {rewards.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">لا توجد مكافآت مسجلة</td></tr>
                ) : rewards.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-slate-300">{r.date}</td>
                    <td className="px-4 py-3 text-slate-300">{r.title}</td>
                    <td className="px-4 py-3 text-teal-400 font-bold">+{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Deductions Table */}
        <div className="bg-[#0b1d31] rounded-xl border border-slate-700 overflow-hidden flex flex-col h-[400px]">
          <div className="p-4 border-b border-slate-700 bg-red-900/20">
            <h3 className="font-bold text-red-400 flex items-center gap-2"><AlertCircle className="h-5 w-5" /> سجل الخصومات</h3>
          </div>
          <div className="overflow-y-auto flex-1 p-0">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-800 text-slate-400 sticky top-0">
                <tr>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">السبب</th>
                  <th className="px-4 py-3 font-medium">النقاط</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {deductions.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">لا توجد خصومات مسجلة</td></tr>
                ) : deductions.map((d, i) => (
                  <tr key={i} className="hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-slate-300">{d.date}</td>
                    <td className="px-4 py-3 text-slate-300">{d.title}</td>
                    <td className="px-4 py-3 text-red-400 font-bold">-{d.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttendanceTab({ reportData }: { reportData: UnifiedMonthlyReport }) {
  const { attendance, dailyTasks } = reportData;

  const attendanceData = [
    { name: 'حضور', value: attendance.presentDays },
    { name: 'غياب', value: attendance.absentDays },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      
      {/* Attendance summary */}
      <div className="bg-[#0b1d31] p-6 rounded-xl border border-slate-700 space-y-6">
        <h3 className="text-lg font-bold text-white flex items-center gap-2"><Clock className="h-5 w-5 text-blue-400" /> الحضور والانصراف</h3>
        
        <div className="flex items-center justify-between">
          <div className="h-[150px] w-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={attendanceData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value">
                  <Cell fill="#14b8a6" />
                  <Cell fill="#ef4444" />
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-3 mr-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">أيام العمل المجدولة:</span>
              <span className="text-white font-bold">{attendance.scheduledDays} يوم</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">الحضور:</span>
              <span className="text-teal-400 font-bold">{attendance.presentDays} يوم</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">الغياب:</span>
              <span className="text-red-400 font-bold">{attendance.absentDays} يوم</span>
            </div>
            <div className="flex justify-between text-sm border-t border-slate-700 pt-2">
              <span className="text-slate-400">معدل الحضور:</span>
              <span className="text-blue-400 font-bold">{attendance.attendanceRate}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tasks summary */}
      <div className="bg-[#0b1d31] p-6 rounded-xl border border-slate-700 space-y-6">
        <h3 className="text-lg font-bold text-white flex items-center gap-2"><CheckSquare className="h-5 w-5 text-purple-400" /> المهام اليومية</h3>
        
        <div className="space-y-4">
          <div className="flex justify-between items-end">
            <div>
              <p className="text-sm text-slate-400">معدل إنجاز المهام</p>
              <p className="text-3xl font-bold text-white">{dailyTasks.completionRate}%</p>
            </div>
            <div className="text-right text-sm space-y-1">
              <p className="text-slate-400">إجمالي المهام: <span className="text-white">{dailyTasks.totalTasks}</span></p>
              <p className="text-slate-400">المنجزة: <span className="text-teal-400">{dailyTasks.completedTasks}</span></p>
            </div>
          </div>
          
          <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-purple-500 rounded-full transition-all"
              style={{ width: `${dailyTasks.completionRate}%` }}
            />
          </div>

          {dailyTasks.lateTasks > 0 && (
            <div className="mt-4 p-3 bg-red-900/20 border border-red-900/50 rounded-lg flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-200 font-medium">يوجد مهام متأخرة</p>
                <p className="text-xs text-red-300/70 mt-1">هناك {dailyTasks.lateTasks} مهمة لم يتم إنجازها في الوقت المحدد مما يؤثر على التقييم العام.</p>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function HistoryTab({ reportData }: { reportData: UnifiedMonthlyReport }) {
  const { historicalTrend } = reportData;

  if (!historicalTrend || historicalTrend.months.length === 0) {
    return <div className="text-center text-slate-400 py-12">لا توجد بيانات تاريخية كافية لعرض التطور</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-[#0b1d31] p-6 rounded-xl border border-slate-700">
        <h3 className="text-lg font-bold text-white mb-6">تطور الأداء (آخر 3 أشهر)</h3>
        
        <div className="h-[350px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historicalTrend.months.slice().reverse()}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" />
              <YAxis yAxisId="left" stroke="#14b8a6" />
              <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="sales" name="المبيعات" stroke="#14b8a6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              <Line yAxisId="right" type="monotone" dataKey="points" name="النقاط" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function RecommendationsTab({ reportData }: { reportData: UnifiedMonthlyReport }) {
  const { recommendations, managerEvaluation } = reportData;

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'medium': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'low': return 'bg-teal-500/10 text-teal-400 border-teal-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'high': return 'أولوية قصوى';
      case 'medium': return 'أولوية متوسطة';
      case 'low': return 'ملاحظة عادية';
      default: return priority;
    }
  };

  return (
    <div className="space-y-6">
      
      {managerEvaluation && (
        <div className="bg-[#0b1d31] p-6 rounded-xl border border-slate-700 mb-6">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Star className="h-5 w-5 text-amber-400" /> تقييم المدير المباشر</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm text-slate-400 mb-2">نقاط القوة</h4>
              <ul className="space-y-1">
                {managerEvaluation.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <CheckCircle className="h-4 w-4 text-teal-400 shrink-0 mt-0.5" /> {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm text-slate-400 mb-2">مجالات التحسين</h4>
              <ul className="space-y-1">
                {managerEvaluation.improvements.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <Target className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          
          {managerEvaluation.managerNotes && (
            <div className="mt-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700">
              <h4 className="text-sm text-slate-400 mb-1">ملاحظات إضافية</h4>
              <p className="text-sm text-slate-200">{managerEvaluation.managerNotes}</p>
            </div>
          )}
        </div>
      )}

      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-blue-400" /> 
        التوصيات الآلية لتحسين الأداء
      </h3>

      <div className="grid grid-cols-1 gap-4">
        {recommendations.length === 0 ? (
          <div className="text-center text-slate-400 py-8 bg-[#0b1d31] rounded-xl border border-slate-700">
            لا توجد توصيات حالياً. الأداء يسير بشكل جيد جداً!
          </div>
        ) : (
          recommendations.map((rec, i) => (
            <div key={i} className="bg-[#0b1d31] p-5 rounded-xl border border-slate-700 flex flex-col md:flex-row gap-4 items-start">
              <div className={`px-3 py-1 rounded-full border text-xs font-medium whitespace-nowrap ${getPriorityColor(rec.priority)}`}>
                {getPriorityLabel(rec.priority)}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-300">{rec.category}</span>
                </div>
                <p className="text-base text-white">{rec.message}</p>
                <p className="text-sm text-teal-400 flex items-center gap-1 mt-2">
                  <Activity className="h-3 w-3" /> خطوة العمل: {rec.actionable}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Small Helpers
// -------------------------------------------------------------

function KpiCard({ title, value, icon: Icon, color }: { title: string, value: string | number, icon: any, color: string }) {
  return (
    <div className="bg-[#0b1d31] p-5 rounded-xl border border-slate-700 flex items-center gap-4">
      <div className={`p-3 rounded-lg bg-slate-800 ${color}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm text-slate-400 mb-1">{title}</p>
        <p className="text-xl font-bold text-white">{value}</p>
      </div>
    </div>
  );
}
