/* eslint-disable react/no-unescaped-entities */
import { useMemo } from 'react';
import {
  TrendingUp,
  Calendar,
  DollarSign,
  Users,
  CheckCircle2,
  AlertTriangle,
  PhoneCall,
  MessageSquare,
} from 'lucide-react';
import type { DailyFollowup } from '@/types/database';

interface DoctorPerformanceAnalysisProps {
  followups: DailyFollowup[];
  doctorName: string;
}

export default function DoctorPerformanceAnalysis({
  followups,
  doctorName,
}: DoctorPerformanceAnalysisProps) {
  const doctorFollowups = useMemo(() => {
    return followups.filter(
      (f) => f.assigned_to === doctorName || f.responsible_name === doctorName
    );
  }, [followups, doctorName]);

  const metrics = useMemo(() => {
    const total = doctorFollowups.length;
    const completed = doctorFollowups.filter(
      (f) => f.status && !['معلق', 'pending', 'لم يرد'].includes(f.status)
    ).length;
    const pending = total - completed;
    const noAnswer = doctorFollowups.filter((f) => f.status === 'لم يرد').length;
    const deferred = doctorFollowups.filter((f) => f.status === 'مؤجل').length;
    const withOrders = doctorFollowups.filter(
      (f) => f.request_type || f.request_details || /أوردر|طلب/.test(f.notes || '')
    ).length;
    const totalPurchase = doctorFollowups.reduce(
      (sum, f) => sum + Number(f.purchase_amount || 0),
      0
    );
    const avgPurchasePerFollowup = completed > 0 ? totalPurchase / completed : 0;

    // Calculate completion rate over time (last 7 days vs previous 7 days)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const recentCompleted = doctorFollowups.filter((f) => {
      const date = new Date(f.closed_at || f.updated_at || f.created_at);
      return date >= sevenDaysAgo && f.status && !['معلق', 'pending', 'لم يرد'].includes(f.status);
    }).length;

    const previousCompleted = doctorFollowups.filter((f) => {
      const date = new Date(f.closed_at || f.updated_at || f.created_at);
      return (
        date >= fourteenDaysAgo &&
        date < sevenDaysAgo &&
        f.status &&
        !['معلق', 'pending', 'لم يرد'].includes(f.status)
      );
    }).length;

    const trend =
      previousCompleted > 0 ? ((recentCompleted - previousCompleted) / previousCompleted) * 100 : 0;

    // Contact method breakdown
    const phoneCalls = doctorFollowups.filter((f) => f.contact_method === 'phone').length;
    const whatsapp = doctorFollowups.filter((f) => f.contact_method === 'whatsapp').length;
    const inPerson = doctorFollowups.filter((f) => f.contact_method === 'in_person').length;

    return {
      total,
      completed,
      pending,
      noAnswer,
      deferred,
      withOrders,
      totalPurchase,
      avgPurchasePerFollowup,
      recentCompleted,
      previousCompleted,
      trend,
      phoneCalls,
      whatsapp,
      inPerson,
      completionRate: total > 0 ? (completed / total) * 100 : 0,
    };
  }, [doctorFollowups]);

  const getTrendColor = (trend: number) => {
    if (trend > 10) return 'text-green-400';
    if (trend > 0) return 'text-teal-400';
    if (trend > -10) return 'text-amber-400';
    return 'text-red-400';
  };

  const getTrendIcon = (trend: number) => {
    if (trend > 0) return '↑';
    if (trend < 0) return '↓';
    return '→';
  };

  if (metrics.total === 0) {
    return (
      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
        <div className="section-title flex items-center gap-2 mb-4">
          <TrendingUp size={20} className="text-teal-300" /> تحليل أداء الدكتور: {doctorName}
        </div>
        <div className="text-center text-slate-400 py-8">لا توجد بيانات متابعة لهذا الدكتور</div>
      </div>
    );
  }

  return (
    <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
      <div className="section-title flex items-center gap-2 mb-4">
        <TrendingUp size={20} className="text-teal-300" /> تحليل أداء الدكتور: {doctorName}
      </div>

      {/* Overview Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <CheckCircle2 size={14} /> معدل الإنجاز
          </div>
          <div className="text-2xl font-bold text-white">{metrics.completionRate.toFixed(1)}%</div>
          <div className="text-xs text-slate-400 mt-1">
            {metrics.completed}/{metrics.total}
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <DollarSign size={14} /> إجمالي المبيعات
          </div>
          <div className="text-2xl font-bold text-teal-300">
            {Math.round(metrics.totalPurchase).toLocaleString('ar-EG')} ج
          </div>
          <div className="text-xs text-slate-400 mt-1">
            متوسط: {Math.round(metrics.avgPurchasePerFollowup).toLocaleString('ar-EG')} ج/متابعة
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <TrendingUp size={14} /> الاتجاه (7 أيام)
          </div>
          <div className={`text-2xl font-bold ${getTrendColor(metrics.trend)}`}>
            {getTrendIcon(metrics.trend)} {Math.abs(metrics.trend).toFixed(1)}%
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {metrics.recentCompleted} vs {metrics.previousCompleted}
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <Users size={14} /> الطلبات
          </div>
          <div className="text-2xl font-bold text-cyan-300">{metrics.withOrders}</div>
          <div className="text-xs text-slate-400 mt-1">
            {metrics.total > 0 ? ((metrics.withOrders / metrics.total) * 100).toFixed(1) : 0}% من
            المتابعات
          </div>
        </div>
      </div>

      {/* Detailed Breakdown */}
      <div className="grid gap-3 md:grid-cols-2 mb-6">
        <div className="bg-white/5 rounded-xl p-4">
          <div className="text-sm font-medium text-white mb-3">حالة المتابعات</div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs">مكتملة</span>
              <span className="text-green-400 font-medium">{metrics.completed}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs">معلقة</span>
              <span className="text-amber-400 font-medium">{metrics.pending}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs">لم يرد</span>
              <span className="text-red-400 font-medium">{metrics.noAnswer}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs">مؤجلة</span>
              <span className="text-purple-400 font-medium">{metrics.deferred}</span>
            </div>
          </div>
        </div>

        <div className="bg-white/5 rounded-xl p-4">
          <div className="text-sm font-medium text-white mb-3">طريقة التواصل</div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs flex items-center gap-1">
                <PhoneCall size={12} /> هاتف
              </span>
              <span className="text-white font-medium">{metrics.phoneCalls}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs flex items-center gap-1">
                <MessageSquare size={12} /> واتساب
              </span>
              <span className="text-white font-medium">{metrics.whatsapp}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs flex items-center gap-1">
                <Users size={12} /> شخصياً
              </span>
              <span className="text-white font-medium">{metrics.inPerson}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Insights */}
      <div className="bg-teal-500/10 border border-teal-400/20 rounded-xl p-4">
        <div className="text-teal-300 font-medium text-sm mb-2">رؤى الأداء</div>
        <div className="text-sm text-slate-300 space-y-1">
          {metrics.completionRate >= 80 && <div>✓ أداء ممتاز - معدل إنجاز عالي</div>}
          {metrics.completionRate >= 60 && metrics.completionRate < 80 && (
            <div>✓ أداء جيد - يمكن تحسين معدل الإنجاز</div>
          )}
          {metrics.completionRate < 60 && (
            <div className="text-amber-300">⚠ يحتاج تحسين - معدل إنجاز منخفض</div>
          )}
          {metrics.trend > 10 && <div>✓ تحسن ملحوظ في الأداء خلال الأسبوع الماضي</div>}
          {metrics.trend < -10 && (
            <div className="text-amber-300">⚠ انخفاض في الأداء خلال الأسبوع الماضي</div>
          )}
          {metrics.withOrders / metrics.total > 0.3 && <div>✓ معدل تحويل جيد إلى طلبات</div>}
          {metrics.noAnswer / metrics.total > 0.3 && (
            <div className="text-amber-300">
              ⚠ معدل "لم يرد" مرتفع - قد تحتاج لتحسين أوقات الاتصال
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
