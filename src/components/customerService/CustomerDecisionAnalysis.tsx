import { useMemo } from "react";
import { Brain, TrendingUp, AlertTriangle, CheckCircle2, DollarSign, Calendar, Target, PhoneCall, MessageSquare } from "lucide-react";
import type { Customer, DailyFollowup } from "@/types/database";

interface CustomerDecisionAnalysisProps {
  customer: Customer;
  followups?: DailyFollowup[];
}

interface DecisionFactor {
  factor: string;
  score: number;
  impact: "positive" | "negative" | "neutral";
  recommendation: string;
}

export default function CustomerDecisionAnalysis({ customer, followups = [] }: CustomerDecisionAnalysisProps) {
  const analysis = useMemo(() => {
    const factors: DecisionFactor[] = [];
    let totalScore = 0;

    // 1. Customer Value Analysis
    if (customer.avg_monthly) {
      if (customer.avg_monthly >= 5000) {
        factors.push({
          factor: "قيمة العميل",
          score: 30,
          impact: "positive",
          recommendation: "عميل عالي القيمة - الأولوية القصوى"
        });
        totalScore += 30;
      } else if (customer.avg_monthly >= 2000) {
        factors.push({
          factor: "قيمة العميل",
          score: 20,
          impact: "positive",
          recommendation: "عميل متوسط القيمة - متابعة دورية"
        });
        totalScore += 20;
      } else {
        factors.push({
          factor: "قيمة العميل",
          score: 10,
          impact: "neutral",
          recommendation: "عميل منخفض القيمة - متابعة عند الطلب"
        });
        totalScore += 10;
      }
    }

    // 2. Retention Status
    if (customer.retention_status === "at_risk") {
      factors.push({
        factor: "حالة الاحتفاظ",
        score: 25,
        impact: "negative",
        recommendation: "في خطر - اتصل فوراً"
      });
      totalScore += 25;
    } else if (customer.retention_status === "threatened") {
      factors.push({
        factor: "حالة الاحتفاظ",
        score: 20,
        impact: "negative",
        recommendation: "مهدد - اتصل قريباً"
      });
      totalScore += 20;
    } else if (customer.retention_status === "loyal") {
      factors.push({
        factor: "حالة الاحتفاظ",
        score: 5,
        impact: "positive",
        recommendation: "عميل مخلص - متابعة دورية"
      });
      totalScore += 5;
    }

    // 3. Last Purchase Analysis
    if (customer.last_purchase) {
      const now = new Date();
      const lastPurchase = new Date(customer.last_purchase);
      const daysSincePurchase = Math.floor((now.getTime() - lastPurchase.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysSincePurchase > 90) {
        factors.push({
          factor: "آخر شراء",
          score: 25,
          impact: "negative",
          recommendation: `لم يشتري منذ ${daysSincePurchase} يوم - إعادة تفعيل`
        });
        totalScore += 25;
      } else if (daysSincePurchase > 60) {
        factors.push({
          factor: "آخر شراء",
          score: 15,
          impact: "negative",
          recommendation: `لم يشتري منذ ${daysSincePurchase} يوم - متابعة`
        });
        totalScore += 15;
      } else if (daysSincePurchase > 30) {
        factors.push({
          factor: "آخر شراء",
          score: 10,
          impact: "neutral",
          recommendation: `آخر شراء قبل ${daysSincePurchase} يوم`
        });
        totalScore += 10;
      }
    }

    // 4. Customer Type
    if (customer.type === "VIP") {
      factors.push({
        factor: "نوع العميل",
        score: 15,
        impact: "positive",
        recommendation: "عميل VIP - معاملة خاصة"
      });
      totalScore += 15;
    } else if (customer.type === "important") {
      factors.push({
        factor: "نوع العميل",
        score: 10,
        impact: "positive",
        recommendation: "عميل مهم - متابعة منتظمة"
      });
      totalScore += 10;
    }

    // 5. Recent Follow-up History
    const recentFollowups = followups.filter((f) => {
      const followupDate = new Date(f.created_at);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return followupDate >= thirtyDaysAgo;
    });

    if (recentFollowups.length > 3) {
      factors.push({
        factor: "تاريخ المتابعة",
        score: -10,
        impact: "neutral",
        recommendation: "متابعات كثيرة مؤخراً - خفض التكرار"
      });
      totalScore -= 10;
    } else if (recentFollowups.length === 0) {
      factors.push({
        factor: "تاريخ المتابعة",
        score: 15,
        impact: "negative",
        recommendation: "لا توجد متابعات مؤخراً - اتصل الآن"
      });
      totalScore += 15;
    }

    // 6. Risk Score
    if (customer.risk_score && customer.risk_score > 70) {
      factors.push({
        factor: "مخاطر الخسارة",
        score: 20,
        impact: "negative",
        recommendation: "مخاطر عالية - اتصل فوراً"
      });
      totalScore += 20;
    }

    // Determine overall decision
    let decision: string;
    let decisionColor: string;
    if (totalScore >= 70) {
      decision = "أولوية قصوى - اتصل فوراً";
      decisionColor = "text-red-400";
    } else if (totalScore >= 50) {
      decision = "أولوية عالية - اتصل اليوم";
      decisionColor = "text-amber-400";
    } else if (totalScore >= 30) {
      decision = "أولوية متوسطة - متابعة هذا الأسبوع";
      decisionColor = "text-teal-400";
    } else {
      decision = "أولوية منخفضة - متابعة دورية";
      decisionColor = "text-green-400";
    }

    return {
      factors,
      totalScore,
      decision,
      decisionColor,
    };
  }, [customer, followups]);

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case "positive": return "text-green-400";
      case "negative": return "text-red-400";
      default: return "text-slate-400";
    }
  };

  const getImpactIcon = (impact: string) => {
    switch (impact) {
      case "positive": return <CheckCircle2 size={14} />;
      case "negative": return <AlertTriangle size={14} />;
      default: return <Target size={14} />;
    }
  };

  return (
    <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
      <div className="section-title flex items-center gap-2 mb-4">
        <Brain size={20} className="text-teal-300" /> تحليل قرار العميل
      </div>

      {/* Overall Decision */}
      <div className="bg-gradient-to-r from-teal-500/20 to-blue-500/20 border border-teal-400/30 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-slate-400 text-xs mb-1">القرار الموصى به</div>
            <div className={`text-lg font-bold ${analysis.decisionColor}`}>
              {analysis.decision}
            </div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 text-xs mb-1">نقاط الأولوية</div>
            <div className="text-3xl font-bold text-white">{analysis.totalScore}</div>
          </div>
        </div>
      </div>

      {/* Decision Factors */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-white mb-3">عوامل القرار</div>
        {analysis.factors.map((factor, index) => (
          <div
            key={index}
            className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-start justify-between gap-3"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className={getImpactColor(factor.impact)}>
                  {getImpactIcon(factor.impact)}
                </span>
                <span className="text-white text-sm font-medium">{factor.factor}</span>
              </div>
              <div className="text-slate-400 text-xs">{factor.recommendation}</div>
            </div>
            <div className={`text-lg font-bold ${factor.score > 0 ? "text-green-400" : factor.score < 0 ? "text-red-400" : "text-slate-400"}`}>
              {factor.score > 0 ? "+" : ""}{factor.score}
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <div className="text-sm font-medium text-white mb-3">إجراءات سريعة</div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secondary text-xs flex items-center justify-center gap-2">
            <PhoneCall size={14} /> اتصال
          </button>
          <button className="btn-secondary text-xs flex items-center justify-center gap-2">
            <MessageSquare size={14} /> واتساب
          </button>
          <button className="btn-secondary text-xs flex items-center justify-center gap-2">
            <Calendar size={14} /> جدولة متابعة
          </button>
          <button className="btn-secondary text-xs flex items-center justify-center gap-2">
            <DollarSign size={14} /> عرض عروض
          </button>
        </div>
      </div>
    </div>
  );
}
