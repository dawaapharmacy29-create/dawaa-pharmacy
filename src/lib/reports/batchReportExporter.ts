import { supabase } from '@/lib/supabase';
import { UnifiedMonthlyReport, generateMonthlyReportPDF } from './monthlyReportPDFGenerator';
import { generateAllStaffReportExcel } from './monthlyReportExcelGenerator';
// Assuming the engine provides this function to build the unified report:
// If it has a different name or path, adjust accordingly.
// import { generateUnifiedMonthlyReport } from './unifiedMonthlyReportEngine';

// Placeholder mock import since the engine file is created in parallel
const generateUnifiedMonthlyReport = async (staffId: string, date: Date): Promise<UnifiedMonthlyReport> => {
  throw new Error('unifiedMonthlyReportEngine not implemented yet');
};

export interface BatchExportProgress {
  total: number;
  current: number;
  currentName: string;
  status: 'loading' | 'generating' | 'done' | 'error';
  errors: string[];
}

export type BatchExportCallback = (progress: BatchExportProgress) => void;

/**
 * Fetch staff based on branch and role filters
 */
async function fetchTargetStaff(branchFilter: string | 'all', roleFilter: string | 'all') {
  let query = supabase.from('staff').select('id, name').eq('status', 'active');
  
  if (branchFilter !== 'all') {
    query = query.eq('branch_id', branchFilter);
  }
  
  if (roleFilter !== 'all') {
    query = query.eq('role', roleFilter);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Generate Excel with one sheet per employee for all staff matching criteria
 */
export async function batchExportExcel(
  branchFilter: string | 'all',
  roleFilter: string | 'all',
  cycleDate: Date,
  onProgress?: BatchExportCallback
): Promise<void> {
  const staffList = await fetchTargetStaff(branchFilter, roleFilter);
  
  if (staffList.length === 0) {
    onProgress?.({ total: 0, current: 0, currentName: '', status: 'done', errors: ['No staff found matching criteria.'] });
    return;
  }

  const reports: UnifiedMonthlyReport[] = [];
  const errors: string[] = [];

  for (let i = 0; i < staffList.length; i++) {
    const staff = staffList[i];
    onProgress?.({ total: staffList.length, current: i + 1, currentName: staff.name, status: 'loading', errors });
    
    try {
      // Build unified report
      const report = await generateUnifiedMonthlyReport(staff.id, cycleDate);
      reports.push(report);
    } catch (err: any) {
      errors.push(`فشل إنشاء تقرير الموظف ${staff.name}: ${err.message}`);
    }
  }

  if (reports.length > 0) {
    onProgress?.({ total: staffList.length, current: staffList.length, currentName: 'جاري إنشاء ملف الإكسيل...', status: 'generating', errors });
    try {
      generateAllStaffReportExcel(reports);
      onProgress?.({ total: staffList.length, current: staffList.length, currentName: 'تم الانتهاء', status: 'done', errors });
    } catch (err: any) {
      errors.push(`فشل حفظ ملف الإكسيل: ${err.message}`);
      onProgress?.({ total: staffList.length, current: staffList.length, currentName: 'خطأ', status: 'error', errors });
    }
  } else {
    onProgress?.({ total: staffList.length, current: staffList.length, currentName: 'لم يتم إنشاء أي تقارير بنجاح', status: 'error', errors });
  }
}

/**
 * Generate individual PDFs sequentially since there's no ZIP library
 * The browser will prompt download for each file.
 */
export async function batchExportPDFZip(
  branchFilter: string | 'all',
  roleFilter: string | 'all',
  cycleDate: Date,
  onProgress?: BatchExportCallback
): Promise<void> {
  const staffList = await fetchTargetStaff(branchFilter, roleFilter);
  
  if (staffList.length === 0) {
    onProgress?.({ total: 0, current: 0, currentName: '', status: 'done', errors: ['No staff found matching criteria.'] });
    return;
  }

  const errors: string[] = [];

  for (let i = 0; i < staffList.length; i++) {
    const staff = staffList[i];
    
    try {
      onProgress?.({ total: staffList.length, current: i + 1, currentName: `تجميع بيانات: ${staff.name}`, status: 'loading', errors });
      const report = await generateUnifiedMonthlyReport(staff.id, cycleDate);
      
      onProgress?.({ total: staffList.length, current: i + 1, currentName: `توليد PDF: ${staff.name}`, status: 'generating', errors });
      await generateMonthlyReportPDF(report);
      
    } catch (err: any) {
      errors.push(`فشل إنشاء تقرير الموظف ${staff.name}: ${err.message}`);
    }
  }

  onProgress?.({ 
    total: staffList.length, 
    current: staffList.length, 
    currentName: 'تم الانتهاء', 
    status: errors.length > 0 ? 'error' : 'done', 
    errors 
  });
}
