import { supabase } from './supabase';
import { filterActiveStaffRows } from './staffActiveFilter';
import { calculateRepeatDeduction, type IncentiveRuleDefinition } from './incentives/incentiveRulesEngine';
import { findIncentiveRule } from '@/lib/incentives/ruleDefinitions';

export interface RepeatErrorRecord {
  id: string;
  staff_id: string;
  staff_name: string;
  rule_id: string;
  rule_title: string;
  base_points: number;
  occurrence_count: number;
  total_deduction: number;
  requires_manager_review: boolean;
  cycle_start: string;
  cycle_end: string;
  created_at: string;
}

export interface RepeatErrorSummary {
  staff_id: string;
  staff_name: string;
  total_errors: number;
  total_deduction: number;
  errors_requiring_review: number;
  most_repeated_errors: Array<{ rule_title: string; count: number; total_deduction: number }>;
}

/**
 * خدمة تتبع الأخطاء المتكررة وحساب الخصومات المتضاعفة
 */
const SEVERE_RULE_CODES = new Set(["DISC-006", "CUST-003", "CUST-018", "SALE-003", "SALE-004"]);

function ruleCodeFromRecord(record: Record<string, unknown>): string {
  const meta = record.metadata && typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : {};
  return String(record.rule_id || record.rule_code || meta.rule_code || meta.rule_id || "");
}

function isSevereRule(ruleCode: string, rule?: IncentiveRuleDefinition | null) {
  if (!ruleCode) return false;
  if (SEVERE_RULE_CODES.has(ruleCode)) return true;
  return rule?.repeat_policy === "manager_review_only" || rule?.approval_required === true && Math.abs(rule.points_delta) >= 50;
}

export class RepeatErrorService {
  /**
   * حساب الخصم المتضاعف لخطأ متكرر
   */
  static calculateRepeatDeduction(basePoints: number, occurrenceCount: number, severe = false) {
    return calculateRepeatDeduction({
      basePoints,
      previousOccurrences: occurrenceCount - 1,
      severe,
    });
  }

  /**
   * الحصول على عدد مرات تكرار خطأ معين لموظف في دورة معينة
   */
  static async getErrorOccurrenceCount(staffId: string, ruleId: string, cycleStart: string, cycleEnd: string): Promise<number> {
    const { data, error } = await supabase
      .from('point_records')
      .select('id')
      .eq('staff_id', staffId)
      .eq('rule_id', ruleId)
      .gte('created_at', cycleStart)
      .lte('created_at', cycleEnd);

    if (error) throw new Error(error.message);
    return data?.length || 0;
  }

  /**
   * الحصول على جميع الأخطاء المتكررة لموظف في دورة معينة
   */
  static async getRepeatErrorsForStaff(staffId: string, cycleStart: string, cycleEnd: string): Promise<RepeatErrorRecord[]> {
    // أولاً، الحصول على جميع سجلات النقاط للموظف في الدورة
    const { data: pointRecords, error } = await supabase
      .from('point_records')
      .select('id, staff_id, staff_name, rule_id, rule_title, points, points_delta, created_at')
      .eq('staff_id', staffId)
      .gte('created_at', cycleStart)
      .lte('created_at', cycleEnd);

    if (error) throw new Error(error.message);

    // تجميع الأخطاء حسب rule_id
    const ruleGroups = new Map<string, Array<typeof pointRecords[number]>>();
    for (const record of pointRecords || []) {
      const ruleId = record.rule_id || 'unknown';
      if (!ruleGroups.has(ruleId)) {
        ruleGroups.set(ruleId, []);
      }
      ruleGroups.get(ruleId)!.push(record);
    }

    // حساب الخصومات المتضاعفة لكل مجموعة
    const repeatErrors: RepeatErrorRecord[] = [];
    for (const [ruleId, records] of ruleGroups.entries()) {
      if (records.length <= 1) continue;

      const firstRecord = records[0] as Record<string, unknown>;
      const ruleCode = ruleCodeFromRecord(firstRecord) || ruleId;
      const ruleDef = findIncentiveRule(ruleCode);
      const basePoints = Math.abs(Number(firstRecord.points_delta || firstRecord.points || ruleDef?.points_delta || 0));
      const occurrenceCount = records.length;
      const severe = isSevereRule(ruleCode, ruleDef);

      const deduction = this.calculateRepeatDeduction(basePoints, occurrenceCount, severe);
      
      repeatErrors.push({
        id: String(firstRecord.id || ""),
        staff_id: staffId,
        staff_name: String(firstRecord.staff_name || 'غير محدد'),
        rule_id: ruleId,
        rule_title: String(firstRecord.rule_title || ruleDef?.title_ar || 'غير محدد'),
        base_points: basePoints,
        occurrence_count: occurrenceCount,
        total_deduction: deduction.finalPoints,
        requires_manager_review: Boolean(deduction.requiresManagerReview),
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        created_at: String(firstRecord.created_at || ""),
      });
    }

    return repeatErrors;
  }

  /**
   * الحصول على ملخص الأخطاء المتكررة لجميع الموظفين في دورة معينة
   */
  static async getRepeatErrorSummary(cycleStart: string, cycleEnd: string): Promise<RepeatErrorSummary[]> {
    // الحصول على جميع الموظفين النشطين
    const { data: staff, error: staffError } = await supabase
      .from('staff')
      .select('id, name, active, is_active, status')
      .limit(500);

    if (staffError) throw new Error(staffError.message);

    const summaries: RepeatErrorSummary[] = [];

    for (const employee of filterActiveStaffRows(staff || [])) {
      const repeatErrors = await this.getRepeatErrorsForStaff(employee.id, cycleStart, cycleEnd);
      
      if (repeatErrors.length === 0) continue;

      const totalDeduction = repeatErrors.reduce((sum, error) => sum + error.total_deduction, 0);
      const errorsRequiringReview = repeatErrors.filter(error => error.requires_manager_review).length;

      // تجميع الأخطاء الأكثر تكراراً
      const errorCounts = new Map<string, { count: number; totalDeduction: number }>();
      for (const error of repeatErrors) {
        const existing = errorCounts.get(error.rule_title) || { count: 0, totalDeduction: 0 };
        existing.count += error.occurrence_count;
        existing.totalDeduction += error.total_deduction;
        errorCounts.set(error.rule_title, existing);
      }

      const mostRepeatedErrors = Array.from(errorCounts.entries())
        .map(([ruleTitle, data]) => ({
          rule_title: ruleTitle,
          count: data.count,
          total_deduction: data.totalDeduction,
        }))
        .sort((a, b) => b.total_deduction - a.total_deduction)
        .slice(0, 5);

      summaries.push({
        staff_id: employee.id,
        staff_name: employee.name || 'غير محدد',
        total_errors: repeatErrors.length,
        total_deduction: totalDeduction,
        errors_requiring_review: errorsRequiringReview,
        most_repeated_errors: mostRepeatedErrors,
      });
    }

    return summaries.sort((a, b) => b.total_deduction - a.total_deduction);
  }

  /**
   * التحقق من ما إذا كان الخطأ يتطلب مراجعة المدير
   */
  static requiresManagerReview(basePoints: number, occurrenceCount: number, severe = false): boolean {
    const deduction = this.calculateRepeatDeduction(basePoints, occurrenceCount, severe);
    return deduction.requiresManagerReview;
  }
}
