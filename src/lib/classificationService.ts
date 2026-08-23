import { supabase } from './supabase';
import { readInvoiceRecordById } from './readModels/invoiceRecordReadModel';

export interface ClassificationRule {
  id: string;
  rule_type: 'customer' | 'invoice';
  condition: string;
  deduction_points: number;
  description: string;
  active: boolean;
  created_at: string;
}

export interface ClassificationViolation {
  id: string;
  staff_id: string;
  staff_name: string;
  rule_id: string;
  rule_type: 'customer' | 'invoice';
  violation_type: string;
  deduction_points: number;
  record_id: string;
  cycle_start: string;
  cycle_end: string;
  created_at: string;
}

export interface ClassificationSummary {
  total_violations: number;
  total_deduction: number;
  violations_by_type: Record<string, number>;
  violations_by_staff: Array<{ staff_name: string; violations: number; deduction: number }>;
  most_common_violations: Array<{ violation_type: string; count: number }>;
}

/**
 * خدمة إدارة قواعد التصنيف للعملاء والفواتير
 */
export class ClassificationService {
  static async getActiveClassificationRules(): Promise<ClassificationRule[]> {
    const { data, error } = await supabase
      .from('classification_rules')
      .select('*')
      .eq('active', true);

    if (error) throw new Error(error.message);
    return data || [];
  }

  static async addClassificationRule(rule: {
    rule_type: 'customer' | 'invoice';
    condition: string;
    deduction_points: number;
    description: string;
  }): Promise<ClassificationRule> {
    const { data, error } = await supabase
      .from('classification_rules')
      .insert({
        rule_type: rule.rule_type,
        condition: rule.condition,
        deduction_points: rule.deduction_points,
        description: rule.description,
        active: true,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  static async updateClassificationRule(
    ruleId: string,
    updates: Partial<ClassificationRule>
  ): Promise<ClassificationRule> {
    const { data, error } = await supabase
      .from('classification_rules')
      .update(updates)
      .eq('id', ruleId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  static async deactivateClassificationRule(ruleId: string): Promise<void> {
    const { error } = await supabase
      .from('classification_rules')
      .update({ active: false })
      .eq('id', ruleId);

    if (error) throw new Error(error.message);
  }

  static async checkCustomerCompliance(
    customerId: string,
    staffId: string,
    cycleStart: string,
    cycleEnd: string
  ): Promise<ClassificationViolation[]> {
    const violations: ClassificationViolation[] = [];
    const rules = await this.getActiveClassificationRules();
    const customerRules = rules.filter((r) => r.rule_type === 'customer');

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .maybeSingle();

    if (customerError) throw new Error(customerError.message);

    const { data: staff } = await supabase
      .from('staff')
      .select('name')
      .eq('id', staffId)
      .maybeSingle();

    for (const rule of customerRules) {
      const violation = await this.evaluateCustomerRule(
        customer,
        rule,
        staffId,
        staff?.name || 'غير محدد',
        cycleStart,
        cycleEnd
      );
      if (violation) violations.push(violation);
    }

    return violations;
  }

  static async checkInvoiceCompliance(
    invoiceId: string,
    staffId: string,
    cycleStart: string,
    cycleEnd: string
  ): Promise<ClassificationViolation[]> {
    const violations: ClassificationViolation[] = [];
    const rules = await this.getActiveClassificationRules();
    const invoiceRules = rules.filter((r) => r.rule_type === 'invoice');

    const invoice = await readInvoiceRecordById(invoiceId);

    const { data: staff } = await supabase
      .from('staff')
      .select('name')
      .eq('id', staffId)
      .maybeSingle();

    for (const rule of invoiceRules) {
      const violation = await this.evaluateInvoiceRule(
        invoice,
        rule,
        staffId,
        staff?.name || 'غير محدد',
        cycleStart,
        cycleEnd
      );
      if (violation) violations.push(violation);
    }

    return violations;
  }

  private static async evaluateCustomerRule(
    customer: any,
    rule: ClassificationRule,
    staffId: string,
    staffName: string,
    cycleStart: string,
    cycleEnd: string
  ): Promise<ClassificationViolation | null> {
    const condition = rule.condition.toLowerCase();
    let violated = false;

    if (
      condition.includes('phone') &&
      (condition.includes('null') || condition.includes('empty'))
    ) {
      if (!customer.phone || customer.phone.trim() === '') violated = true;
    }

    if (condition.includes('code') && (condition.includes('null') || condition.includes('empty'))) {
      if (!customer.customer_code || customer.customer_code.trim() === '') violated = true;
    }

    if (
      condition.includes('classification') &&
      (condition.includes('null') || condition.includes('empty'))
    ) {
      if (!customer.segment || customer.segment.trim() === '') violated = true;
    }

    if (violated) {
      return {
        id: crypto.randomUUID(),
        staff_id: staffId,
        staff_name: staffName,
        rule_id: rule.id,
        rule_type: rule.rule_type,
        violation_type: rule.description,
        deduction_points: rule.deduction_points,
        record_id: customer.id,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        created_at: new Date().toISOString(),
      };
    }

    return null;
  }

  private static async evaluateInvoiceRule(
    invoice: any,
    rule: ClassificationRule,
    staffId: string,
    staffName: string,
    cycleStart: string,
    cycleEnd: string
  ): Promise<ClassificationViolation | null> {
    const condition = rule.condition.toLowerCase();
    let violated = false;

    if (
      condition.includes('customer_code') &&
      (condition.includes('null') || condition.includes('empty'))
    ) {
      if (!invoice?.customer_code || invoice.customer_code.trim() === '') violated = true;
    }

    if (
      condition.includes('customer_phone') &&
      (condition.includes('null') || condition.includes('empty'))
    ) {
      if (!invoice?.customer_phone || invoice.customer_phone.trim() === '') violated = true;
    }

    if (condition.includes('amount') && condition.includes('zero')) {
      if (!invoice?.amount || invoice.amount === 0) violated = true;
    }

    if (violated && invoice) {
      return {
        id: crypto.randomUUID(),
        staff_id: staffId,
        staff_name: staffName,
        rule_id: rule.id,
        rule_type: rule.rule_type,
        violation_type: rule.description,
        deduction_points: rule.deduction_points,
        record_id: String(invoice.id),
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        created_at: new Date().toISOString(),
      };
    }

    return null;
  }

  static async getClassificationSummary(
    cycleStart: string,
    cycleEnd: string
  ): Promise<ClassificationSummary> {
    const { data: violations, error } = await supabase
      .from('classification_violations')
      .select('*')
      .gte('created_at', cycleStart)
      .lte('created_at', cycleEnd);

    if (error) throw new Error(error.message);

    const totalViolations = violations?.length || 0;
    const totalDeduction = violations?.reduce((sum, v) => sum + (v.deduction_points || 0), 0) || 0;

    const violationsByType: Record<string, number> = {};
    for (const v of violations || []) {
      const type = v.violation_type || 'غير محدد';
      violationsByType[type] = (violationsByType[type] || 0) + 1;
    }

    const violationsByStaff = new Map<
      string,
      { staff_name: string; violations: number; deduction: number }
    >();
    for (const v of violations || []) {
      const key = v.staff_id;
      const existing = violationsByStaff.get(key) || {
        staff_name: v.staff_name || 'غير محدد',
        violations: 0,
        deduction: 0,
      };
      existing.violations += 1;
      existing.deduction += v.deduction_points || 0;
      violationsByStaff.set(key, existing);
    }

    const violationCounts = new Map<string, number>();
    for (const v of violations || []) {
      const type = v.violation_type || 'غير محدد';
      violationCounts.set(type, (violationCounts.get(type) || 0) + 1);
    }

    const mostCommonViolations = Array.from(violationCounts.entries())
      .map(([violation_type, count]) => ({ violation_type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      total_violations: totalViolations,
      total_deduction: totalDeduction,
      violations_by_type: violationsByType,
      violations_by_staff: Array.from(violationsByStaff.values()).sort(
        (a, b) => b.deduction - a.deduction
      ),
      most_common_violations: mostCommonViolations,
    };
  }
}
