import { supabase } from './supabase';
import {
  calculateQuarterlyIncentive,
  getQuarterRange,
  QUARTERLY_BASE_BONUS_EGP,
} from './incentives/incentiveRulesEngine';
import { QUARTERLY_SCORE_MAX_2027 } from './dawaa2027';

export interface QuarterlyIncentiveCalculation {
  staff_id: string;
  staff_name: string;
  quarter: string;
  quarter_start: string;
  quarter_end: string;
  sales_growth: number;
  sales_growth_score: number;
  avg_invoice: number;
  avg_invoice_score: number;
  customer_retention: number;
  customer_retention_score: number;
  list_targets: number;
  list_targets_score: number;
  stagnant_moved: number;
  stagnant_moved_score: number;
  data_quality: number;
  data_quality_score: number;
  total_score: number;
  base_bonus: number;
  deductions: number;
  rewards: number;
  final_incentive: number;
}

export interface QuarterlyPillarScore {
  key: string;
  label: string;
  weight: number;
  score: number;
  weighted_score: number;
  max_weighted_score: number;
}

/**
 * خدمة حساب الحوافز الربع سنوية
 */
export class QuarterlyIncentiveService {
  /**
   * حساب الحافز الربع سنوي لموظف
   */
  static async calculateQuarterlyIncentiveForStaff(
    staffId: string,
    date?: Date
  ): Promise<QuarterlyIncentiveCalculation> {
    const quarterRange = getQuarterRange(date);
    const { data: staff } = await supabase
      .from('staff')
      .select('name, branch')
      .eq('id', staffId)
      .maybeSingle();

    // الحصول على بيانات المبيعات للموظف في الربع
    const salesData = await this.getStaffSalesData(staffId, quarterRange.start, quarterRange.end);

    // حساب درجات الأعمدة الستة
    const pillars = await this.calculatePillarScores(
      staffId,
      quarterRange.start,
      quarterRange.end,
      salesData
    );

    // حساب الدرجة الإجمالية
    const totalScore = pillars.reduce((sum, p) => sum + p.score, 0);
    const maxScore = pillars.reduce((sum, p) => sum + p.max_weighted_score, 0);
    const normalizedScore = (totalScore / maxScore) * QUARTERLY_SCORE_MAX_2027;

    // حساب الحوافز
    const baseBonus = QUARTERLY_BASE_BONUS_EGP;
    const deductions = await this.calculateQuarterlyDeductions(
      staffId,
      quarterRange.start,
      quarterRange.end
    );
    const rewards = await this.calculateQuarterlyRewards(
      staffId,
      quarterRange.start,
      quarterRange.end
    );

    const incentiveCalc = calculateQuarterlyIncentive({
      approvedQuarterlyDeductions: deductions,
      approvedQuarterlyRewards: rewards,
      baseValue: baseBonus,
    });

    return {
      staff_id: staffId,
      staff_name: staff?.name || 'غير محدد',
      quarter: quarterRange.label,
      quarter_start: quarterRange.start.toISOString(),
      quarter_end: quarterRange.end.toISOString(),
      sales_growth: salesData.sales_growth || 0,
      sales_growth_score: pillars.find((p) => p.key === 'sales_growth')?.score || 0,
      avg_invoice: salesData.avg_invoice || 0,
      avg_invoice_score: pillars.find((p) => p.key === 'avg_invoice')?.score || 0,
      customer_retention: salesData.customer_retention || 0,
      customer_retention_score: pillars.find((p) => p.key === 'customer_value')?.score || 0,
      list_targets: salesData.list_targets || 0,
      list_targets_score: pillars.find((p) => p.key === 'list_targets')?.score || 0,
      stagnant_moved: salesData.stagnant_moved || 0,
      stagnant_moved_score: pillars.find((p) => p.key === 'stagnant_stock')?.score || 0,
      data_quality: salesData.data_quality || 0,
      data_quality_score: pillars.find((p) => p.key === 'data_quality')?.score || 0,
      total_score: normalizedScore,
      base_bonus: baseBonus,
      deductions: deductions,
      rewards: rewards,
      final_incentive: incentiveCalc.quarterlyFinalValue,
    };
  }

  /**
   * الحصول على بيانات المبيعات للموظف
   */
  private static async getStaffSalesData(
    staffId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    const { data: salesSummary } = await supabase
      .from('staff_sales_summary')
      .select('*')
      .eq('staff_id', staffId)
      .gte('period_start', startDate.toISOString())
      .lte('period_end', endDate.toISOString());

    if (!salesSummary || salesSummary.length === 0) {
      return {
        sales_growth: 0,
        avg_invoice: 0,
        customer_retention: 0,
        list_targets: 0,
        stagnant_moved: 0,
        data_quality: 0,
      };
    }

    // تجميع البيانات من جميع الشهور في الربع
    const totalSales = salesSummary.reduce((sum, s) => sum + (s.total_sales || 0), 0);
    const totalInvoices = salesSummary.reduce((sum, s) => sum + (s.invoice_count || 0), 0);
    const avgInvoice = totalInvoices > 0 ? totalSales / totalInvoices : 0;

    return {
      sales_growth: salesSummary[0]?.sales_growth || 0,
      avg_invoice: avgInvoice,
      customer_retention: salesSummary[0]?.customer_retention || 0,
      list_targets: salesSummary[0]?.list_targets || 0,
      stagnant_moved: salesSummary[0]?.stagnant_moved || 0,
      data_quality: salesSummary[0]?.data_quality || 0,
    };
  }

  /**
   * حساب درجات الأعمدة الستة
   */
  private static async calculatePillarScores(
    staffId: string,
    startDate: Date,
    endDate: Date,
    salesData: any
  ): Promise<QuarterlyPillarScore[]> {
    const pillars = [
      { key: 'sales_growth', label: 'إجمالي المبيعات ونموها', weight: 25 },
      { key: 'avg_invoice', label: 'متوسط الفاتورة', weight: 20 },
      { key: 'customer_value', label: 'العملاء المتكررون والمهمون', weight: 20 },
      { key: 'list_targets', label: 'أدوية اللستة', weight: 15 },
      { key: 'stagnant_stock', label: 'الرواكد والمخزون', weight: 10 },
      { key: 'data_quality', label: 'جودة التسجيل وخدمة العميل', weight: 10 },
    ];

    return pillars.map((pillar) => {
      let score = 0;

      switch (pillar.key) {
        case 'sales_growth':
          score = this.calculateSalesGrowthScore(salesData.sales_growth);
          break;
        case 'avg_invoice':
          score = this.calculateAvgInvoiceScore(salesData.avg_invoice);
          break;
        case 'customer_value':
          score = this.calculateCustomerRetentionScore(salesData.customer_retention);
          break;
        case 'list_targets':
          score = this.calculateListTargetsScore(salesData.list_targets);
          break;
        case 'stagnant_stock':
          score = this.calculateStagnantScore(salesData.stagnant_moved);
          break;
        case 'data_quality':
          score = this.calculateDataQualityScore(salesData.data_quality);
          break;
      }

      return {
        key: pillar.key,
        label: pillar.label,
        weight: pillar.weight,
        score: score,
        weighted_score: (score / 100) * pillar.weight,
        max_weighted_score: pillar.weight,
      };
    });
  }

  /**
   * حساب درجة نمو المبيعات
   */
  private static calculateSalesGrowthScore(growth: number): number {
    if (growth >= 20) return 100;
    if (growth >= 15) return 90;
    if (growth >= 10) return 80;
    if (growth >= 5) return 70;
    if (growth >= 0) return 60;
    if (growth >= -5) return 50;
    if (growth >= -10) return 40;
    if (growth >= -15) return 30;
    return 20;
  }

  /**
   * حساب درجة متوسط الفاتورة
   */
  private static calculateAvgInvoiceScore(avgInvoice: number): number {
    if (avgInvoice >= 500) return 100;
    if (avgInvoice >= 400) return 90;
    if (avgInvoice >= 300) return 80;
    if (avgInvoice >= 200) return 70;
    if (avgInvoice >= 150) return 60;
    if (avgInvoice >= 100) return 50;
    return 40;
  }

  /**
   * حساب درجة الاحتفاظ بالعملاء
   */
  private static calculateCustomerRetentionScore(retention: number): number {
    if (retention >= 80) return 100;
    if (retention >= 70) return 90;
    if (retention >= 60) return 80;
    if (retention >= 50) return 70;
    if (retention >= 40) return 60;
    return 50;
  }

  /**
   * حساب درجة أهداف اللستة
   */
  private static calculateListTargetsScore(targets: number): number {
    if (targets >= 90) return 100;
    if (targets >= 80) return 90;
    if (targets >= 70) return 80;
    if (targets >= 60) return 70;
    if (targets >= 50) return 60;
    return 50;
  }

  /**
   * حساب درجة تحريك الرواكد
   */
  private static calculateStagnantScore(stagnant: number): number {
    if (stagnant >= 80) return 100;
    if (stagnant >= 70) return 90;
    if (stagnant >= 60) return 80;
    if (stagnant >= 50) return 70;
    if (stagnant >= 40) return 60;
    return 50;
  }

  /**
   * حساب درجة جودة البيانات
   */
  private static calculateDataQualityScore(quality: number): number {
    if (quality >= 90) return 100;
    if (quality >= 80) return 90;
    if (quality >= 70) return 80;
    if (quality >= 60) return 70;
    if (quality >= 50) return 60;
    return 50;
  }

  /**
   * حساب الخصومات الربع سنوية
   */
  private static async calculateQuarterlyDeductions(
    staffId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const { data: deductions } = await supabase
      .from('quarterly_deductions')
      .select('amount')
      .eq('staff_id', staffId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    return deductions?.reduce((sum, d) => sum + (d.amount || 0), 0) || 0;
  }

  /**
   * حساب المكافآت الربع سنوية
   */
  private static async calculateQuarterlyRewards(
    staffId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const { data: rewards } = await supabase
      .from('quarterly_rewards')
      .select('amount')
      .eq('staff_id', staffId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    return rewards?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;
  }

  /**
   * الحصول على ملخص الحوافز الربع سنوية لجميع الموظفين
   */
  static async getQuarterlyIncentiveSummary(date?: Date): Promise<QuarterlyIncentiveCalculation[]> {
    const { data: staff } = await supabase.from('staff').select('id').eq('active', true);

    const summaries: QuarterlyIncentiveCalculation[] = [];

    for (const employee of staff || []) {
      const calculation = await this.calculateQuarterlyIncentiveForStaff(employee.id, date);
      summaries.push(calculation);
    }

    return summaries.sort((a, b) => b.final_incentive - a.final_incentive);
  }
}
