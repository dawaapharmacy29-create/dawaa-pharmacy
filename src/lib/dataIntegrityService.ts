import { supabase } from '@/lib/supabase';
import { readInvoiceDataHealth } from '@/lib/readModels/invoiceDataHealthReadModel';

export type DataHealthIssue = {
  type:
    | 'invoice_no_doctor'
    | 'invoice_no_customer'
    | 'duplicate_staff'
    | 'cash_as_points'
    | 'no_staff_id'
    | 'classification_issue';
  severity: 'low' | 'medium' | 'high' | 'critical';
  count: number;
  description: string;
  affectedIds?: string[];
};

export type DataHealthReport = {
  totalInvoices: number;
  invoicesWithoutDoctor: number;
  invoicesWithoutCustomer: number;
  duplicateStaffCount: number;
  cashRewardsAsPoints: number;
  recordsWithoutStaffId: number;
  classificationIssues: number;
  issues: DataHealthIssue[];
  lastChecked: string;
};

const DIAGNOSTIC_SAMPLE_LIMIT = 100;

export async function checkDataHealth(): Promise<DataHealthReport> {
  const issues: DataHealthIssue[] = [];

  // Invoice integrity checks live behind a dedicated transactional read boundary.
  // Counts are exact while affectedIds are intentionally bounded diagnostic samples.
  const invoiceHealth = await readInvoiceDataHealth();

  if (invoiceHealth.withoutDoctorCount > 0) {
    issues.push({
      type: 'invoice_no_doctor',
      severity: 'high',
      count: invoiceHealth.withoutDoctorCount,
      description: 'فواتير بدون دكتور مسجل',
      affectedIds: invoiceHealth.withoutDoctorIds,
    });
  }

  if (invoiceHealth.withoutCustomerCount > 0) {
    issues.push({
      type: 'invoice_no_customer',
      severity: 'medium',
      count: invoiceHealth.withoutCustomerCount,
      description: 'فواتير بدون عميل مسجل',
      affectedIds: invoiceHealth.withoutCustomerIds,
    });
  }

  // Check duplicate staff
  const { data: staffWithDuplicates, error: staffError } = await supabase
    .from('staff')
    .select('id, name, duplicate_count')
    .gt('duplicate_count', 1);

  if (!staffError && staffWithDuplicates) {
    issues.push({
      type: 'duplicate_staff',
      severity: 'low',
      count: staffWithDuplicates.length,
      description: 'دكاترة مكررين في النظام',
      affectedIds: staffWithDuplicates.map((s: any) => s.id),
    });
  }

  // Historical stagnant/list cash rewards must never be counted as monthly performance points.
  // Count suspicious positive-point rows exactly, but only return a bounded ID sample for review.
  const cashAsPoints = await supabase
    .from('employee_transactions')
    .select('id', { count: 'exact' })
    .gt('points_delta', 0)
    .or(
      'reason.ilike.%راكد%,reason.ilike.%لستة%,reason.ilike.%incentive%,source.eq.stagnant_medicine_dispense,source.eq.incentive_medicine_sale,source.eq.incentive_medicine_sales'
    )
    .limit(DIAGNOSTIC_SAMPLE_LIMIT);

  if (!cashAsPoints.error && Number(cashAsPoints.count || 0) > 0) {
    issues.push({
      type: 'cash_as_points',
      severity: 'high',
      count: Number(cashAsPoints.count || 0),
      description: 'مكافآت مالية محتملة مسجلة كنقاط بدلاً من جنيه',
      affectedIds: (cashAsPoints.data || []).map((row: any) => String(row.id || '')).filter(Boolean),
    });
  }

  // Check employee ledger records without any canonical staff identity.
  const noStaffId = await supabase
    .from('employee_transactions')
    .select('id', { count: 'exact' })
    .is('staff_id', null)
    .is('employee_id', null)
    .limit(DIAGNOSTIC_SAMPLE_LIMIT);

  if (!noStaffId.error && Number(noStaffId.count || 0) > 0) {
    issues.push({
      type: 'no_staff_id',
      severity: 'critical',
      count: Number(noStaffId.count || 0),
      description: 'سجلات نقاط بدون staff_id',
      affectedIds: (noStaffId.data || []).map((row: any) => String(row.id || '')).filter(Boolean),
    });
  }

  if (invoiceHealth.withoutClassificationCount > 0) {
    issues.push({
      type: 'classification_issue',
      severity: 'low',
      count: invoiceHealth.withoutClassificationCount,
      description: 'فواتير بدون تصنيف عميل',
      affectedIds: invoiceHealth.withoutClassificationIds,
    });
  }

  return {
    totalInvoices: invoiceHealth.totalInvoices,
    invoicesWithoutDoctor: issues.find((i) => i.type === 'invoice_no_doctor')?.count || 0,
    invoicesWithoutCustomer: issues.find((i) => i.type === 'invoice_no_customer')?.count || 0,
    duplicateStaffCount: issues.find((i) => i.type === 'duplicate_staff')?.count || 0,
    cashRewardsAsPoints: issues.find((i) => i.type === 'cash_as_points')?.count || 0,
    recordsWithoutStaffId: issues.find((i) => i.type === 'no_staff_id')?.count || 0,
    classificationIssues: issues.find((i) => i.type === 'classification_issue')?.count || 0,
    issues,
    lastChecked: new Date().toISOString(),
  };
}

export function getHealthSeverityColor(severity: DataHealthIssue['severity']): string {
  switch (severity) {
    case 'critical':
      return 'text-red-400 bg-red-500/10 border-red-500/20';
    case 'high':
      return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
    case 'medium':
      return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    case 'low':
      return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
  }
}
