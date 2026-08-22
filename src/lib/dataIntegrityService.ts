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

export async function checkDataHealth(): Promise<DataHealthReport> {
  const issues: DataHealthIssue[] = [];

  // Invoice integrity checks live behind a dedicated transactional read boundary.
  const invoiceHealth = await readInvoiceDataHealth();

  if (invoiceHealth.withoutDoctorIds.length) {
    issues.push({
      type: 'invoice_no_doctor',
      severity: 'high',
      count: invoiceHealth.withoutDoctorIds.length,
      description: 'فواتير بدون دكتور مسجل',
      affectedIds: invoiceHealth.withoutDoctorIds,
    });
  }

  if (invoiceHealth.withoutCustomerIds.length) {
    issues.push({
      type: 'invoice_no_customer',
      severity: 'medium',
      count: invoiceHealth.withoutCustomerIds.length,
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

  // Check cash rewards recorded as points
  const { data: cashAsPoints, error: cashError } = await supabase
    .from('employee_transactions')
    .select('id, reason, points_delta')
    .ilike('reason', '%راكد%')
    .or('reason.ilike.%لستة%,reason.ilike.%incentive%');

  if (!cashError && cashAsPoints) {
    const pointsRecords = cashAsPoints.filter((r: any) => r.points_delta && r.points_delta > 0);
    if (pointsRecords.length > 0) {
      issues.push({
        type: 'cash_as_points',
        severity: 'high',
        count: pointsRecords.length,
        description: 'مكافآت مالية مسجلة كنقاط بدلاً من جنيه',
        affectedIds: pointsRecords.map((r: any) => r.id),
      });
    }
  }

  // Check records without staff_id
  const { data: noStaffId, error: noStaffError } = await supabase
    .from('employee_transactions')
    .select('id')
    .is('staff_id', null)
    .is('employee_id', null);

  if (!noStaffError && noStaffId) {
    issues.push({
      type: 'no_staff_id',
      severity: 'critical',
      count: noStaffId.length,
      description: 'سجلات نقاط بدون staff_id',
      affectedIds: noStaffId.map((r: any) => r.id),
    });
  }

  if (invoiceHealth.withoutClassificationIds.length) {
    issues.push({
      type: 'classification_issue',
      severity: 'low',
      count: invoiceHealth.withoutClassificationIds.length,
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
