import { parseCustomerFile, importCustomersToDB, type CustomerParseResult, type ImportSummary } from './invoiceImporter';
import { supabase } from './supabase';

export interface CustomerBulkImportResult {
  parseResult: CustomerParseResult;
  importSummary: ImportSummary;
  errors: string[];
  warnings: string[];
}

export async function importCustomersFromArrayBuffer(
  arrayBuffer: ArrayBuffer,
  fileName: string,
  importBatch: string
): Promise<CustomerBulkImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // تحليل الملف
    const parseResult: CustomerParseResult = parseCustomerFile(arrayBuffer, fileName);

    if (parseResult.errors.length > 0) {
      errors.push(`تم العثور على ${parseResult.errors.length} أخطاء في تحليل الملف`);
      parseResult.errors.forEach(err => {
        errors.push(`صف ${err.row}: ${err.field} - ${err.message}`);
      });
    }

    if (parseResult.rows.length === 0) {
      errors.push('لم يتم العثور على أي بيانات صالحة في الملف');
      return { parseResult, importSummary: {} as ImportSummary, errors, warnings };
    }

    // استيراد البيانات إلى قاعدة البيانات
    const importSummary: ImportSummary = await importCustomersToDB(parseResult.rows, importBatch);

    if (importSummary.errors.length > 0) {
      errors.push(`تم العثور على ${importSummary.errors.length} أخطاء أثناء الاستيراد`);
      importSummary.errors.forEach(err => {
        errors.push(`صف ${err.row}: ${err.field} - ${err.message}`);
      });
    }

    // إضافة تحذيرات
    if (importSummary.skippedDuplicates > 0) {
      warnings.push(`تم تخطي ${importSummary.skippedDuplicates} سجل مكرر`);
    }

    if (importSummary.newCustomers > 0) {
      warnings.push(`تم إضافة ${importSummary.newCustomers} عميل جديد`);
    }

    if (importSummary.updatedCustomers > 0) {
      warnings.push(`تم تحديث ${importSummary.updatedCustomers} عميل موجود`);
    }

    return { parseResult, importSummary, errors, warnings };

  } catch (error) {
    errors.push(`خطأ عام: ${(error as Error).message}`);
    return { parseResult: { rows: [], errors: [], headers: [] }, importSummary: {} as ImportSummary, errors, warnings };
  }
}

export async function getExistingCustomersCount(): Promise<number> {
  const { count, error } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('خطأ في جلب عدد العملاء:', error);
    return 0;
  }

  return count || 0;
}

export async function getExistingCustomerCodes(): Promise<string[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('customer_code');

  if (error) {
    console.error('خطأ في جلب أكواد العملاء:', error);
    return [];
  }

  return (data || []).map((row: any) => row.customer_code).filter(Boolean);
}
