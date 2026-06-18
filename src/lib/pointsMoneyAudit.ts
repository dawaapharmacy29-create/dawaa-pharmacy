import { supabase } from './supabase';

export interface PointsMoneyAuditResult {
  table: string;
  totalRecords: number;
  suspiciousRecords: number;
  issues: string[];
  warnings: string[];
}

export interface SuspiciousRecord {
  table: string;
  id: string;
  field: string;
  value: number;
  reason: string;
}

/**
 * تدقيق جداول النقاط للتأكد من عدم خلط النقاط بالمال
 */
export async function auditPointsMoneyMixing(): Promise<{
  results: PointsMoneyAuditResult[];
  suspiciousRecords: SuspiciousRecord[];
}> {
  const results: PointsMoneyAuditResult[] = [];
  const suspiciousRecords: SuspiciousRecord[] = [];

  // تدقيق employee_transactions
  const employeeTxnAudit = await auditEmployeeTransactions();
  results.push(employeeTxnAudit.result);
  suspiciousRecords.push(...employeeTxnAudit.suspiciousRecords);

  // تدقيق points_transactions
  const pointsTxnAudit = await auditPointsTransactions();
  results.push(pointsTxnAudit.result);
  suspiciousRecords.push(...pointsTxnAudit.suspiciousRecords);

  // تدقيق point_records
  const pointRecordsAudit = await auditPointRecords();
  results.push(pointRecordsAudit.result);
  suspiciousRecords.push(...pointRecordsAudit.suspiciousRecords);

  return { results, suspiciousRecords };
}

async function auditEmployeeTransactions(): Promise<{
  result: PointsMoneyAuditResult;
  suspiciousRecords: SuspiciousRecord[];
}> {
  const { data, error } = await supabase
    .from('employee_transactions')
    .select('id, points, points_delta, type, reason, created_at')
    .limit(1000);

  if (error) {
    return {
      result: {
        table: 'employee_transactions',
        totalRecords: 0,
        suspiciousRecords: 0,
        issues: [error.message],
        warnings: [],
      },
      suspiciousRecords: [],
    };
  }

  const suspicious: SuspiciousRecord[] = [];
  const issues: string[] = [];
  const warnings: string[] = [];

  for (const row of data || []) {
    const points = row.points;
    const pointsDelta = row.points_delta;

    // التحقق من القيم العشرية المشبوهة
    if (points !== null && points !== undefined && !Number.isInteger(points)) {
      if (Math.abs(points) > 1000) {
        suspicious.push({
          table: 'employee_transactions',
          id: row.id,
          field: 'points',
          value: points,
          reason: 'قيمة عشرية كبيرة قد تكون مال وليس نقاط',
        });
      }
    }

    if (pointsDelta !== null && pointsDelta !== undefined && !Number.isInteger(pointsDelta)) {
      if (Math.abs(pointsDelta) > 1000) {
        suspicious.push({
          table: 'employee_transactions',
          id: row.id,
          field: 'points_delta',
          value: pointsDelta,
          reason: 'قيمة عشرية كبيرة قد تكون مال وليس نقاط',
        });
      }
    }

    // التحقق من القيم السالبة الكبيرة
    if (points !== null && points !== undefined && points < -500) {
      warnings.push(`سجل ${row.id}: خصم نقاط كبير جداً (${points})`);
    }

    if (pointsDelta !== null && pointsDelta !== undefined && pointsDelta < -500) {
      warnings.push(`سجل ${row.id}: خصم نقاط كبير جداً (${pointsDelta})`);
    }
  }

  return {
    result: {
      table: 'employee_transactions',
      totalRecords: data?.length || 0,
      suspiciousRecords: suspicious.length,
      issues,
      warnings,
    },
    suspiciousRecords: suspicious,
  };
}

async function auditPointsTransactions(): Promise<{
  result: PointsMoneyAuditResult;
  suspiciousRecords: SuspiciousRecord[];
}> {
  const { data, error } = await supabase
    .from('points_transactions')
    .select('id, points, points_delta, reason, created_at')
    .limit(1000);

  if (error) {
    return {
      result: {
        table: 'points_transactions',
        totalRecords: 0,
        suspiciousRecords: 0,
        issues: [error.message],
        warnings: [],
      },
      suspiciousRecords: [],
    };
  }

  const suspicious: SuspiciousRecord[] = [];
  const issues: string[] = [];
  const warnings: string[] = [];

  for (const row of data || []) {
    const points = row.points;
    const pointsDelta = row.points_delta;

    // التحقق من القيم العشرية المشبوهة
    if (points !== null && points !== undefined && !Number.isInteger(points)) {
      if (Math.abs(points) > 1000) {
        suspicious.push({
          table: 'points_transactions',
          id: row.id,
          field: 'points',
          value: points,
          reason: 'قيمة عشرية كبيرة قد تكون مال وليس نقاط',
        });
      }
    }

    if (pointsDelta !== null && pointsDelta !== undefined && !Number.isInteger(pointsDelta)) {
      if (Math.abs(pointsDelta) > 1000) {
        suspicious.push({
          table: 'points_transactions',
          id: row.id,
          field: 'points_delta',
          value: pointsDelta,
          reason: 'قيمة عشرية كبيرة قد تكون مال وليس نقاط',
        });
      }
    }

    // التحقق من القيم السالبة الكبيرة
    if (points !== null && points !== undefined && points < -500) {
      warnings.push(`سجل ${row.id}: خصم نقاط كبير جداً (${points})`);
    }

    if (pointsDelta !== null && pointsDelta !== undefined && pointsDelta < -500) {
      warnings.push(`سجل ${row.id}: خصم نقاط كبير جداً (${pointsDelta})`);
    }
  }

  return {
    result: {
      table: 'points_transactions',
      totalRecords: data?.length || 0,
      suspiciousRecords: suspicious.length,
      issues,
      warnings,
    },
    suspiciousRecords: suspicious,
  };
}

async function auditPointRecords(): Promise<{
  result: PointsMoneyAuditResult;
  suspiciousRecords: SuspiciousRecord[];
}> {
  const { data, error } = await supabase
    .from('point_records')
    .select('id, points, points_delta, reason, created_at')
    .limit(1000);

  if (error) {
    return {
      result: {
        table: 'point_records',
        totalRecords: 0,
        suspiciousRecords: 0,
        issues: [error.message],
        warnings: [],
      },
      suspiciousRecords: [],
    };
  }

  const suspicious: SuspiciousRecord[] = [];
  const issues: string[] = [];
  const warnings: string[] = [];

  for (const row of data || []) {
    const points = row.points;
    const pointsDelta = row.points_delta;

    // التحقق من القيم العشرية المشبوهة
    if (points !== null && points !== undefined && !Number.isInteger(points)) {
      if (Math.abs(points) > 1000) {
        suspicious.push({
          table: 'point_records',
          id: row.id,
          field: 'points',
          value: points,
          reason: 'قيمة عشرية كبيرة قد تكون مال وليس نقاط',
        });
      }
    }

    if (pointsDelta !== null && pointsDelta !== undefined && !Number.isInteger(pointsDelta)) {
      if (Math.abs(pointsDelta) > 1000) {
        suspicious.push({
          table: 'point_records',
          id: row.id,
          field: 'points_delta',
          value: pointsDelta,
          reason: 'قيمة عشرية كبيرة قد تكون مال وليس نقاط',
        });
      }
    }

    // التحقق من القيم السالبة الكبيرة
    if (points !== null && points !== undefined && points < -500) {
      warnings.push(`سجل ${row.id}: خصم نقاط كبير جداً (${points})`);
    }

    if (pointsDelta !== null && pointsDelta !== undefined && pointsDelta < -500) {
      warnings.push(`سجل ${row.id}: خصم نقاط كبير جداً (${pointsDelta})`);
    }
  }

  return {
    result: {
      table: 'point_records',
      totalRecords: data?.length || 0,
      suspiciousRecords: suspicious.length,
      issues,
      warnings,
    },
    suspiciousRecords: suspicious,
  };
}

/**
 * إنشاء تقرير صحة البيانات للنقاط
 */
export async function createPointsDataHealthReport(): Promise<{
  totalRecords: number;
  suspiciousRecords: number;
  issues: string[];
  warnings: string[];
}> {
  const audit = await auditPointsMoneyMixing();

  const totalRecords = audit.results.reduce((sum, r) => sum + r.totalRecords, 0);
  const suspiciousRecords = audit.suspiciousRecords.length;
  const issues = audit.results.flatMap((r) => r.issues);
  const warnings = audit.results.flatMap((r) => r.warnings);

  return {
    totalRecords,
    suspiciousRecords,
    issues,
    warnings,
  };
}
