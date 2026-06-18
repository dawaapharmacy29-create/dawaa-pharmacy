import { useMemo } from 'react';
import {
  Lightbulb,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Target,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { DailyFollowup } from '@/types/database';

interface ContinuousImprovementProps {
  followups: DailyFollowup[];
  staffName?: string;
}

interface ImprovementSuggestion {
  id: string;
  category: 'performance' | 'process' | 'customer' | 'team';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  actionable: boolean;
  impact: string;
}

export default function ContinuousImprovement({
  followups,
  staffName,
}: ContinuousImprovementProps) {
  const suggestions = useMemo(() => {
    const suggestionsList: ImprovementSuggestion[] = [];

    // Filter followups for specific staff if provided
    const relevantFollowups = staffName
      ? followups.filter((f) => f.responsible_name === staffName || f.assigned_to === staffName)
      : followups;

    // 1. Analyze completion rates
    const total = relevantFollowups.length;
    const completed = relevantFollowups.filter(
      (f) => f.status && !['معلق', 'pending', 'لم يرد'].includes(f.status)
    ).length;
    const pending = relevantFollowups.filter((f) => f.status === 'معلق').length;
    const noAnswer = relevantFollowups.filter((f) => f.status === 'لم يرد').length;

    if (total > 0) {
      const completionRate = (completed / total) * 100;

      if (completionRate < 50) {
        suggestionsList.push({
          id: '1',
          category: 'performance',
          priority: 'high',
          title: 'تحسين معدل الإنجاز',
          description: `معدل الإنجاز الحالي ${completionRate.toFixed(1)}% - يحتاج تحسين كبير`,
          actionable: true,
          impact: 'زيادة الإنتاجية بنسبة 30-50%',
        });
      } else if (completionRate < 70) {
        suggestionsList.push({
          id: '2',
          category: 'performance',
          priority: 'medium',
          title: 'رفع معدل الإنجاز',
          description: `معدل الإنجاز الحالي ${completionRate.toFixed(1)}% - يمكن تحسينه`,
          actionable: true,
          impact: 'زيادة الإنتاجية بنسبة 15-20%',
        });
      }
    }

    // 2. Analyze "no answer" rate
    if (total > 0 && noAnswer / total > 0.3) {
      suggestionsList.push({
        id: '3',
        category: 'process',
        priority: 'high',
        title: 'تقليل معدل عدم الرد',
        description: `معدل عدم الرد ${((noAnswer / total) * 100).toFixed(1)}% مرتفع جداً`,
        actionable: true,
        impact: 'تحسين معدل التواصل بنسبة 40%',
      });
    }

    // 3. Analyze pending followups
    if (pending > 10) {
      suggestionsList.push({
        id: '4',
        category: 'process',
        priority: 'high',
        title: 'تقليل المتابعات المعلقة',
        description: `يوجد ${pending} متابعة معلقة - يحتاج معالجة فورية`,
        actionable: true,
        impact: 'تحسين سرعة الاستجابة',
      });
    }

    // 4. Analyze purchase conversion
    const withPurchases = relevantFollowups.filter((f) => f.purchase_after_followup).length;
    if (total > 0) {
      const conversionRate = (withPurchases / total) * 100;

      if (conversionRate < 20) {
        suggestionsList.push({
          id: '5',
          category: 'customer',
          priority: 'medium',
          title: 'تحسين معدل التحويل',
          description: `معدل التحويل الحالي ${conversionRate.toFixed(1)}% - يمكن تحسينه`,
          actionable: true,
          impact: 'زيادة المبيعات بنسبة 25%',
        });
      }
    }

    // 5. Analyze follow-up timing
    const now = new Date();
    const overdueFollowups = relevantFollowups.filter((f) => {
      if (!f.next_followup_date) return false;
      const nextDate = new Date(f.next_followup_date);
      return nextDate < now && f.status === 'معلق';
    });

    if (overdueFollowups.length > 5) {
      suggestionsList.push({
        id: '6',
        category: 'process',
        priority: 'high',
        title: 'معالجة المتابعات المتأخرة',
        description: `يوجد ${overdueFollowups.length} متابعة متأخرة`,
        actionable: true,
        impact: 'تحسين جودة الخدمة',
      });
    }

    // 6. Analyze contact methods
    const phoneCalls = relevantFollowups.filter((f) => f.contact_method === 'phone').length;
    const whatsapp = relevantFollowups.filter((f) => f.contact_method === 'whatsapp').length;

    if (phoneCalls > whatsapp * 3) {
      suggestionsList.push({
        id: '7',
        category: 'process',
        priority: 'low',
        title: 'زيادة استخدام واتساب',
        description: 'استخدام واتساب أكثر قد يزيد معدل الرد',
        actionable: true,
        impact: 'تحسين معدل الرد بنسبة 20%',
      });
    }

    // 7. General improvement suggestions
    suggestionsList.push({
      id: '8',
      category: 'team',
      priority: 'medium',
      title: 'تدريب منتظم',
      description: 'تنفيذ جلسات تدريب أسبوعية لتحسين مهارات التواصل',
      actionable: true,
      impact: 'تحسين الأداء العام بنسبة 15%',
    });

    suggestionsList.push({
      id: '9',
      category: 'performance',
      priority: 'low',
      title: 'مراجعة الأهداف',
      description: 'مراجعة وتحديث أهداف المتابعة شهرياً',
      actionable: true,
      impact: 'تحسين التركيز والوضوح',
    });

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestionsList.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return suggestionsList;
  }, [followups, staffName]);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'performance':
        return <TrendingUp size={16} />;
      case 'process':
        return <Target size={16} />;
      case 'customer':
        return <CheckCircle2 size={16} />;
      case 'team':
        return <ArrowUp size={16} />;
      default:
        return <Lightbulb size={16} />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'performance':
        return 'text-purple-400';
      case 'process':
        return 'text-cyan-400';
      case 'customer':
        return 'text-green-400';
      case 'team':
        return 'text-teal-400';
      default:
        return 'text-amber-400';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-500/20 text-red-300 border-red-400/30';
      case 'medium':
        return 'bg-amber-500/20 text-amber-300 border-amber-400/30';
      case 'low':
        return 'bg-green-500/20 text-green-300 border-green-400/30';
      default:
        return 'bg-slate-500/20 text-slate-300 border-slate-400/30';
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'عالية';
      case 'medium':
        return 'متوسطة';
      case 'low':
        return 'منخفضة';
      default:
        return 'غير محدد';
    }
  };

  return (
    <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
      <div className="section-title flex items-center gap-2 mb-4">
        <Lightbulb size={20} className="text-teal-300" /> اقتراحات التحسين المستمر
      </div>

      {suggestions.length === 0 ? (
        <div className="text-center text-slate-400 py-8">لا توجد اقتراحات حالياً - الأداء جيد!</div>
      ) : (
        <div className="space-y-3">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className={getCategoryColor(suggestion.category)}>
                    {getCategoryIcon(suggestion.category)}
                  </span>
                  <span className="text-white font-medium text-sm">{suggestion.title}</span>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full border ${getPriorityColor(suggestion.priority)}`}
                >
                  {getPriorityBadge(suggestion.priority)}
                </span>
              </div>

              <p className="text-slate-400 text-xs mb-3">{suggestion.description}</p>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">التأثير المتوقع:</span>
                  <span className="text-teal-300">{suggestion.impact}</span>
                </div>
                {suggestion.actionable && (
                  <button className="text-xs text-teal-300 hover:text-teal-200 transition-colors">
                    تنفيذ الإجراء
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary Stats */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-2xl font-bold text-white">
              {suggestions.filter((s) => s.priority === 'high').length}
            </div>
            <div className="text-xs text-slate-400">أولوية عالية</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-white">
              {suggestions.filter((s) => s.priority === 'medium').length}
            </div>
            <div className="text-xs text-slate-400">أولوية متوسطة</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-white">
              {suggestions.filter((s) => s.actionable).length}
            </div>
            <div className="text-xs text-slate-400">قابلة للتنفيذ</div>
          </div>
        </div>
      </div>
    </div>
  );
}
