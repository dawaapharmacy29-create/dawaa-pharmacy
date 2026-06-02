import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { clearCustomersCache } from "@/lib/api/customers";
import { clearCustomerServiceCommandCenterCache } from "@/lib/api/customerServiceCommandCenter";
import { clearCustomerProfileCache } from "@/lib/customerProfileService";
import { clearExecutiveDashboardCache } from "@/lib/executiveDashboardDataService";
import { clearSalesAnalyticsSummaryCache } from "@/lib/salesAnalyticsSummaryService";
import { logActivity } from "@/lib/activityLog";

export const CUSTOMER_PHONE_CONFIRMATION = "تحديث أرقام العملاء";

export type CustomerPhoneCsvRow = {
  final_customer_key?: string | null;
  customer_id?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  branch?: string | null;
  current_phone?: string | null;
  new_phone?: string | null;
  new_whatsapp_phone?: string | null;
  notes?: string | null;
};

export type CustomerPhoneUpdateResultRow = {
  row_no: number;
  customer_code: string | null;
  customer_name: string | null;
  branch: string | null;
  match_method: string | null;
  status: string;
  new_phone: string | null;
  new_whatsapp_phone: string | null;
  existing_phone: string | null;
  existing_whatsapp_phone: string | null;
  would_update_phone: boolean;
  would_update_whatsapp: boolean;
};

export type CustomerPhoneUpdateResult = {
  apply: boolean;
  rowsInFile: number;
  matchedCustomers: number;
  validPhones: number;
  validWhatsappPhones: number;
  invalidPhones: number;
  wouldUpdatePhone: number;
  wouldUpdateWhatsapp: number;
  customersUpdated: number;
  skippedExistingValid: number;
  unmatchedRows: number;
  needsReviewRows: number;
  rows: CustomerPhoneUpdateResultRow[];
  metricsRefreshed?: boolean;
  cacheInvalidated?: boolean;
  invalidSummaryPhoneCountBefore?: number | null;
  invalidSummaryPhoneCountAfter?: number | null;
};

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeRow(row: Record<string, unknown>): CustomerPhoneCsvRow {
  return {
    final_customer_key: clean(row.final_customer_key),
    customer_id: clean(row.customer_id),
    customer_code: clean(row.customer_code),
    customer_name: clean(row.customer_name),
    branch: clean(row.branch),
    current_phone: clean(row.current_phone),
    new_phone: clean(row.new_phone),
    new_whatsapp_phone: clean(row.new_whatsapp_phone),
    notes: clean(row.notes),
  };
}

export async function parseCustomerPhoneCsv(file: File): Promise<CustomerPhoneCsvRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const sheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows.map(normalizeRow).filter((row) => row.customer_id || row.customer_code || row.final_customer_key || row.customer_name || row.new_phone || row.new_whatsapp_phone);
}

export async function previewCustomerPhoneUpdate(rows: CustomerPhoneCsvRow[]): Promise<CustomerPhoneUpdateResult> {
  const invalidBefore = await countInvalidCustomerSummaryPhones();
  const { data, error } = await supabase.rpc("safe_customer_phone_update_from_json", {
    p_rows: rows,
    p_apply: false,
  });
  if (error) throw new Error(error.message);
  return { ...(data as CustomerPhoneUpdateResult), invalidSummaryPhoneCountBefore: invalidBefore };
}

export async function applyCustomerPhoneUpdate(
  rows: CustomerPhoneCsvRow[],
  actor: { id?: string | null; name?: string | null; role?: string | null } = {},
): Promise<CustomerPhoneUpdateResult> {
  const { data, error } = await supabase.rpc("safe_customer_phone_update_from_json", {
    p_rows: rows,
    p_apply: true,
  });
  if (error) throw new Error(error.message);

  const result = data as CustomerPhoneUpdateResult;

  clearCustomersCache();
  clearCustomerServiceCommandCenterCache();
  clearCustomerProfileCache();
  clearExecutiveDashboardCache();
  clearSalesAnalyticsSummaryCache();
  result.cacheInvalidated = true;
  result.metricsRefreshed = true;
  result.invalidSummaryPhoneCountAfter = await countInvalidCustomerSummaryPhones();

  await logActivity({
    action: "تحديث أرقام العملاء",
    module: "استيراد العملاء",
    target_type: "customers",
    target_id: "customer_phone_update_csv",
    user_id: actor.id || null,
    user_name: actor.name || "النظام",
    user_role: actor.role || null,
    route_path: "/invoices",
    details: {
      updated_phone_count: result.wouldUpdatePhone,
      updated_whatsapp_count: result.wouldUpdateWhatsapp,
      skipped_count: result.skippedExistingValid + result.invalidPhones,
      unmatched_count: result.unmatchedRows,
      needs_review_count: result.needsReviewRows,
      customers_updated: result.customersUpdated,
      timestamp: new Date().toISOString(),
    },
  });

  return result;
}

async function countInvalidCustomerSummaryPhones() {
  const { count, error } = await supabase
    .from("customer_metrics_summary")
    .select("final_customer_key", { count: "exact", head: true })
    .or("customer_phone.is.null,customer_phone.eq.,customer_phone.ilike.code:%");
  if (error) return null;
  return count ?? 0;
}
