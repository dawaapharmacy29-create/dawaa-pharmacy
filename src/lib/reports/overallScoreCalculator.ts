import type { PillarScore } from './pillarScoreCalculator';

export type StaffRoleCategory = 'doctor' | 'assistant' | 'delivery' | 'manager' | 'customer_service' | 'other';

export interface OverallScoreInput {
  role: StaffRoleCategory;
  salesScore: number;      // 0-100
  customersScore: number;   // 0-100
  qualityScore: number;     // 0-100 (conversation reviews avg)
  attendanceScore: number;  // 0-100
  tasksScore: number;       // 0-100
  inventoryScore: number;   // 0-100
  serviceScore: number;     // 0-100 (followup completion etc)
  teamScore?: number;       // 0-100 (for managers only)
  pillarScores?: PillarScore[];
}

export interface OverallScoreResult {
  score: number;     // 0-100
  grade: string;     // ممتاز / جيد جداً / جيد / مقبول / يحتاج تحسين
  gradeColor: string; // tailwind color class
  breakdown: {
    label: string;
    weight: number;
    score: number;
    weightedScore: number;
  }[];
}

export function mapRoleToCategory(role: string): StaffRoleCategory {
  const r = (role || '').toLowerCase();
  if (r.includes('doctor') || r === 'دكتور') return 'doctor';
  if (r.includes('assistant') || r === 'مساعد') return 'assistant';
  if (r.includes('delivery') || r === 'توصيل' || r === 'طيار') return 'delivery';
  if (r.includes('manager') || r.includes('admin') || r === 'مدير') return 'manager';
  if (r.includes('customer_service') || r === 'خدمة عملاء') return 'customer_service';
  return 'other';
}

function getGradeInfo(score: number): { grade: string; color: string } {
  if (score >= 90) return { grade: 'ممتاز', color: 'text-green-600 dark:text-green-400' };
  if (score >= 80) return { grade: 'جيد جداً', color: 'text-blue-600 dark:text-blue-400' };
  if (score >= 70) return { grade: 'جيد', color: 'text-teal-600 dark:text-teal-400' };
  if (score >= 60) return { grade: 'مقبول', color: 'text-amber-600 dark:text-amber-400' };
  return { grade: 'يحتاج تحسين', color: 'text-red-600 dark:text-red-400' };
}

export function calculateOverallScore(input: OverallScoreInput): OverallScoreResult {
  const breakdown: OverallScoreResult['breakdown'] = [];
  let totalScore = 0;
  
  const addCategory = (label: string, weight: number, score: number) => {
    if (weight > 0) {
      const weightedScore = (score * weight) / 100;
      totalScore += weightedScore;
      breakdown.push({
        label,
        weight,
        score: Math.round(score),
        weightedScore: Number(weightedScore.toFixed(2))
      });
    }
  };

  switch (input.role) {
    case 'doctor':
      addCategory('المبيعات والتسجيل', 30, input.salesScore);
      addCategory('العملاء والمتابعات', 15, input.customersScore);
      addCategory('جودة المحادثات', 15, input.qualityScore);
      addCategory('الحضور والانصراف', 15, input.attendanceScore);
      addCategory('المهام والتشغيل', 10, input.tasksScore);
      addCategory('المخزون والرواكد', 10, input.inventoryScore);
      addCategory('خدمات أخرى', 5, input.serviceScore);
      break;

    case 'assistant':
      addCategory('المبيعات والتسجيل', 10, input.salesScore);
      addCategory('العملاء والمتابعات', 10, input.customersScore);
      addCategory('جودة المحادثات', 5, input.qualityScore);
      addCategory('الحضور والانصراف', 25, input.attendanceScore);
      addCategory('المهام والتشغيل', 25, input.tasksScore);
      addCategory('المخزون والرواكد', 15, input.inventoryScore);
      addCategory('خدمات أخرى', 10, input.serviceScore);
      break;

    case 'delivery':
      addCategory('المبيعات والتسجيل', 5, input.salesScore);
      addCategory('العملاء والمتابعات', 5, input.customersScore);
      addCategory('الحضور والانصراف', 30, input.attendanceScore);
      addCategory('المهام والتشغيل', 30, input.tasksScore);
      addCategory('المخزون والرواكد', 5, input.inventoryScore);
      addCategory('جودة التوصيل/الخدمات', 25, input.serviceScore);
      break;

    case 'manager':
      addCategory('المبيعات والتسجيل', 20, input.salesScore);
      addCategory('العملاء والمتابعات', 15, input.customersScore);
      addCategory('جودة المحادثات', 10, input.qualityScore);
      addCategory('الحضور والانصراف', 15, input.attendanceScore);
      addCategory('المهام والتشغيل', 10, input.tasksScore);
      addCategory('المخزون والرواكد', 10, input.inventoryScore);
      addCategory('خدمات أخرى', 5, input.serviceScore);
      addCategory('أداء الفريق', 15, input.teamScore || 0);
      break;

    case 'customer_service':
      addCategory('المبيعات والتسجيل', 5, input.salesScore);
      addCategory('العملاء والمتابعات', 15, input.customersScore);
      addCategory('جودة المحادثات', 10, input.qualityScore);
      addCategory('الحضور والانصراف', 20, input.attendanceScore);
      addCategory('المهام والتشغيل', 20, input.tasksScore);
      addCategory('الخدمة والمتابعات', 30, input.serviceScore);
      break;

    case 'other':
    default:
      addCategory('المبيعات والتسجيل', 15, input.salesScore);
      addCategory('العملاء والمتابعات', 15, input.customersScore);
      addCategory('جودة المحادثات', 14, input.qualityScore);
      addCategory('الحضور والانصراف', 14, input.attendanceScore);
      addCategory('المهام والتشغيل', 14, input.tasksScore);
      addCategory('المخزون والرواكد', 14, input.inventoryScore);
      addCategory('الخدمة', 14, input.serviceScore);
      break;
  }

  const finalScore = Math.max(0, Math.min(Math.round(totalScore), 100));
  const gradeInfo = getGradeInfo(finalScore);

  return {
    score: finalScore,
    grade: gradeInfo.grade,
    gradeColor: gradeInfo.color,
    breakdown
  };
}
