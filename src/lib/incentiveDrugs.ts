/**
 * نظام حوافز الأدوية
 * أدوية محددة لها حافز خاص عند بيعها
 */

export interface IncentiveDrug {
  id: string;
  branch: string;
  drug_code: string;
  drug_name: string;
  generic_name: string;
  manufacturer: string;
  incentive_amount_per_unit: number; // الحافز بالجنيه لكل علبة
  currency: "جنيه" | "قرش";
  current_quantity: number;
  current_stock_value: number; // القيمة الإجمالية للمخزون
  month_sales_quantity?: number;
  month_sales_value?: number;
  month_commission_earned?: number;
  incentive_type: "ثابت" | "تدريجي"; // ثابت = نفس الحافز لكل علبة، تدريجي = يزيد مع الكمية
  target_monthly_quantity?: number;
  bonus_tier_2?: number; // كمية تشغل bonus إضافي
  bonus_amount_tier_2?: number; // الحافز الإضافي
  active_period_start: string;
  active_period_end: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  notes: string;
  created_by_name: string;
}

export const INCENTIVE_TYPES = {
  ثابت: "حافز ثابت لكل علبة",
  تدريجي: "حافز يزيد حسب الكمية المباعة",
} as const;

/**
 * حساب الحافز المكتسب من بيع دواء
 */
export function calculateIncentive(
  drug: IncentiveDrug,
  quantitySold: number
): { incentive: number; explanation: string } {
  const today = new Date();
  const startDate = new Date(drug.active_period_start);
  const endDate = new Date(drug.active_period_end);

  // التحقق من الفترة الزمنية
  if (today < startDate || today > endDate) {
    return {
      incentive: 0,
      explanation: "الدواء خارج فترة الحافز الحالية",
    };
  }

  if (!drug.is_active) {
    return {
      incentive: 0,
      explanation: "الدواء غير مفعل حالياً",
    };
  }

  let incentive = 0;
  let explanation = "";

  if (drug.incentive_type === "ثابت") {
    incentive = drug.incentive_amount_per_unit * quantitySold;
    explanation = `${quantitySold} × ${drug.incentive_amount_per_unit} ج = ${incentive} ج`;
  } else if (drug.incentive_type === "تدريجي") {
    // الكمية الأولى بالسعر الأساسي
    incentive = drug.incentive_amount_per_unit * quantitySold;
    explanation = `${quantitySold} × ${drug.incentive_amount_per_unit} ج = ${incentive} ج`;

    // bonus إضافي إذا تجاوزت الكمية
    if (
      drug.bonus_tier_2 &&
      drug.bonus_amount_tier_2 &&
      quantitySold >= drug.bonus_tier_2
    ) {
      const bonusQuantity = quantitySold - (drug.bonus_tier_2 - 1);
      const bonusAmount = bonusQuantity * drug.bonus_amount_tier_2;
      incentive += bonusAmount;
      explanation += ` + ${bonusQuantity} × ${drug.bonus_amount_tier_2} ج (bonus) = ${incentive} ج`;
    }
  }

  return { incentive, explanation };
}

/**
 * نسبة البيع المتقدمة مقابل الهدف الشهري
 */
export function getSalesProgress(drug: IncentiveDrug): {
  percentage: number;
  status: "ممتاز" | "جيد" | "متوسط" | "ضعيف";
  message: string;
} {
  if (!drug.target_monthly_quantity) {
    return { percentage: 0, status: "متوسط", message: "لا يوجد هدف شهري محدد" };
  }

  const sold = drug.month_sales_quantity || 0;
  const percentage = (sold / drug.target_monthly_quantity) * 100;

  let status: "ممتاز" | "جيد" | "متوسط" | "ضعيف";
  if (percentage >= 100) status = "ممتاز";
  else if (percentage >= 75) status = "جيد";
  else if (percentage >= 50) status = "متوسط";
  else status = "ضعيف";

  return {
    percentage: Math.min(percentage, 100),
    status,
    message: `بيع ${sold} / ${drug.target_monthly_quantity} وحدة`,
  };
}

/**
 * إنشاء ملف CSV لقائمة الحوافز
 */
export function exportToCSV(drugs: IncentiveDrug[]): string {
  const headers = [
    "الفرع",
    "اسم الدواء",
    "الاسم العام",
    "الحافز لكل علبة",
    "الكمية المتاحة",
    "مبيعات الشهر",
    "الحافز المكتسب",
    "الهدف الشهري",
    "النسبة المتقدمة",
  ];

  const rows = drugs.map((drug) => {
    const progress = getSalesProgress(drug);
    return [
      drug.branch,
      drug.drug_name,
      drug.generic_name,
      `${drug.incentive_amount_per_unit} ج`,
      drug.current_quantity,
      drug.month_sales_quantity || 0,
      `${drug.month_commission_earned || 0} ج`,
      drug.target_monthly_quantity || "—",
      `${progress.percentage.toFixed(0)}%`,
    ];
  });

  const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join(
    "\n"
  );
  return csv;
}

/**
 * فلترة الأدوية النشطة فقط
 */
export function getActiveDrugs(drugs: IncentiveDrug[]): IncentiveDrug[] {
  const today = new Date();
  return drugs.filter((drug) => {
    const startDate = new Date(drug.active_period_start);
    const endDate = new Date(drug.active_period_end);
    return (
      drug.is_active && today >= startDate && today <= endDate
    );
  });
}

/**
 * ترتيب الأدوية حسب الحافز الأعلى
 */
export function sortByIncentive(drugs: IncentiveDrug[]): IncentiveDrug[] {
  return [...drugs].sort(
    (a, b) => b.incentive_amount_per_unit - a.incentive_amount_per_unit
  );
}

/**
 * ترتيب الأدوية حسب الكمية المتاحة
 */
export function sortByStock(drugs: IncentiveDrug[]): IncentiveDrug[] {
  return [...drugs].sort((a, b) => b.current_quantity - a.current_quantity);
}

/**
 * البحث عن أدوية باسم أو كود
 */
export function searchDrugs(drugs: IncentiveDrug[], query: string): IncentiveDrug[] {
  const q = query.toLowerCase();
  return drugs.filter(
    (drug) =>
      drug.drug_name.toLowerCase().includes(q) ||
      drug.generic_name.toLowerCase().includes(q) ||
      drug.drug_code.toLowerCase().includes(q)
  );
}

/**
 * إنشاء/تحديث دواء حافز
 */
export interface CreateIncentiveDrugInput {
  drug_code: string;
  drug_name: string;
  generic_name: string;
  manufacturer: string;
  incentive_amount_per_unit: number;
  incentive_type: "ثابت" | "تدريجي";
  target_monthly_quantity?: number;
  bonus_tier_2?: number;
  bonus_amount_tier_2?: number;
  active_period_start: string;
  active_period_end: string;
  notes?: string;
  branch: string;
}
