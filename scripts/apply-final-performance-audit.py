from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str, required: bool = True) -> str:
    if new in text:
        print(f"{label}: already applied")
        return text
    if old not in text:
        if required:
            raise SystemExit(f"{label}: source block not found")
        print(f"{label}: skipped; source block changed")
        return text
    print(f"{label}: applied")
    return text.replace(old, new, 1)


# Customers page: prevent duplicate list request after first load.
page = Path("src/pages/Customers.tsx")
text = page.read_text(encoding="utf-8")
text = replace_once(
    text,
    "  const requestIdRef = useRef(0);\n",
    "  const requestIdRef = useRef(0);\n  const hasLoadedCustomersRef = useRef(false);\n",
    "customers loaded ref",
)
text = replace_once(
    text,
    "    if (customers.length) setRefreshing(true);\n    else setLoading(true);\n",
    "    if (hasLoadedCustomersRef.current) setRefreshing(true);\n    else setLoading(true);\n",
    "customers duplicate-load guard",
)
text = replace_once(
    text,
    "      setCustomers(result.customers);\n      setTotalCount(result.count);\n",
    "      setCustomers(result.customers);\n      setTotalCount(result.count);\n      hasLoadedCustomersRef.current = true;\n",
    "customers loaded flag",
)
text = replace_once(
    text,
    "    branchFilter,\n    customers.length,\n    debouncedSearch,\n",
    "    branchFilter,\n    debouncedSearch,\n",
    "remove customer length dependency",
)
page.write_text(text, encoding="utf-8")


# Customer monthly analytics: 36 exact-count requests -> one RPC.
api = Path("src/lib/api/customers.ts")
text = api.read_text(encoding="utf-8")
pattern = re.compile(
    r"export async function getCustomerMonthlyAnalytics\(months = 6\): Promise<CustomerMonthlyAnalytics> \{.*?\n\}\n\nexport async function getCustomerStats",
    re.S,
)
replacement = """export async function getCustomerMonthlyAnalytics(months = 6): Promise<CustomerMonthlyAnalytics> {
  if (!isSupabaseConfigured) {
    throw new Error('إعدادات Supabase غير موجودة.');
  }

  const safeMonths = Math.min(Math.max(months, 3), 12);
  const { data, error } = await supabase.rpc('get_customer_monthly_analytics_v2', {
    p_months: safeMonths,
  });
  if (error) throw new Error(`customer monthly analytics: ${error.message}`);

  const rows = ((data || []) as Array<Record<string, unknown>>).map((row) => {
    const monthStartValue = String(row.month_start || '').slice(0, 10);
    const monthDate = monthStartValue ? new Date(`${monthStartValue}T12:00:00`) : new Date();
    return {
      month: monthStartValue.slice(0, 7),
      label: monthLabel(monthDate),
      registeredCustomers: toNumber(row.registered_customers),
      purchasedCustomers: toNumber(row.purchased_customers),
      veryImportant: toNumber(row.very_important),
      important: toNumber(row.important),
      medium: toNumber(row.medium),
      normal: toNumber(row.normal),
    };
  });

  return {
    rows,
    source: 'customers + customer_metrics_summary (optimized RPC)',
    warnings: [],
  };
}

export async function getCustomerStats"""
new_text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    if "get_customer_monthly_analytics_v2" not in text:
        raise SystemExit("customer monthly analytics function block not found")
    print("customer monthly analytics RPC: already applied")
else:
    print("customer monthly analytics RPC: applied")
    text = new_text
api.write_text(text, encoding="utf-8")


# Invoices: summarize/audit in DB instead of transferring 5k/3k rows.
invoices = Path("src/pages/Invoices.tsx")
text = invoices.read_text(encoding="utf-8")
summary_pattern = re.compile(
    r"  const loadInvoiceSummarySnapshot = useCallback\(async \(\) => \{.*?\n  \}, \[\]\);\n\n  const loadDuplicateAudit",
    re.S,
)
summary_replacement = """  const loadInvoiceSummarySnapshot = useCallback(async () => {
    setSummarySnapshotBusy(true);
    setSummarySnapshotMessage(null);
    try {
      const { data, error } = await supabase.rpc('get_invoice_management_summary_v1', {
        p_limit: 5000,
      });
      if (error) throw error;
      const snapshot = (data || {}) as {
        totalInvoices?: number;
        totalSales?: number;
        latestUpdatedAt?: string | null;
        latestBatchStatus?: string | null;
        branchRows?: Array<{ branch_name: string; invoices_count: number; net_total: number; updated_at: string | null }>;
        dailyRows?: Array<{ summary_date: string; invoices_count: number; net_total: number; updated_at: string | null }>;
      };
      setSummarySnapshot({
        totalInvoices: Number(snapshot.totalInvoices || 0),
        totalSales: Number(snapshot.totalSales || 0),
        latestUpdatedAt: snapshot.latestUpdatedAt || null,
        latestBatchStatus: snapshot.latestBatchStatus || null,
        branchRows: snapshot.branchRows || [],
        dailyRows: snapshot.dailyRows || [],
      });
      setSummarySnapshotMessage('ملخص سريع محسوب مباشرة داخل قاعدة البيانات.');
    } catch (error) {
      setSummarySnapshotMessage(`تعذر تحميل ملخصات الفواتير: ${(error as Error).message}`);
      setSummarySnapshot(null);
    } finally {
      setSummarySnapshotBusy(false);
    }
  }, []);

  const loadDuplicateAudit"""
text2, count = summary_pattern.subn(summary_replacement, text, count=1)
if count != 1:
    if "get_invoice_management_summary_v1" not in text:
        raise SystemExit("invoice summary block not found")
    print("invoice server summary: already applied")
else:
    print("invoice server summary: applied")
    text = text2

duplicate_pattern = re.compile(
    r"  const loadDuplicateAudit = useCallback\(async \(\) => \{.*?\n  \}, \[isAdmin\]\);",
    re.S,
)
duplicate_replacement = """  const loadDuplicateAudit = useCallback(async () => {
    if (!canManageBatches) return;
    setDuplicateAuditLoading(true);
    const { data, error } = await supabase.rpc('get_invoice_duplicate_audit_v1', {
      p_limit: 3000,
    });
    if (error) {
      toast.error(`تعذر فحص التكرارات: ${error.message}`);
      setDuplicateAudit([]);
    } else {
      setDuplicateAudit(
        ((data || []) as Array<Record<string, unknown>>).map((row) => ({
          invoice_number: String(row.invoice_number || ''),
          branch: String(row.branch || 'غير محدد'),
          sale_date: String(row.sale_date || '').slice(0, 10),
          count: Number(row.count || 0),
          latest_created_at: row.latest_created_at ? String(row.latest_created_at) : null,
        }))
      );
    }
    setDuplicateAuditLoading(false);
  }, [canManageBatches]);"""
text2, count = duplicate_pattern.subn(duplicate_replacement, text, count=1)
if count != 1:
    if "get_invoice_duplicate_audit_v1" not in text:
        raise SystemExit("invoice duplicate audit block not found")
    print("invoice duplicate RPC: already applied")
else:
    print("invoice duplicate RPC: applied")
    text = text2

old_branch = """      const { data, error } = await supabase
        .from('sales_invoices')
        .select('branch, invoice_no')
        .neq('branch', selectedBranch)
        .not('invoice_no', 'is', null)
        .limit(20000);
      if (error || !data) return;
      const otherBranchRanges = new Map<string, { min: number; max: number; count: number }>();
      for (const row of data as Array<{ branch: string | null; invoice_no: string | null }>) {
        const n = Number(String(row.invoice_no || '').replace(/[^\\d]/g, ''));
        if (!Number.isFinite(n) || n <= 0 || !row.branch) continue;
        const current = otherBranchRanges.get(row.branch) || { min: n, max: n, count: 0 };
        current.min = Math.min(current.min, n);
        current.max = Math.max(current.max, n);
        current.count += 1;
        otherBranchRanges.set(row.branch, current);
      }
"""
new_branch = """      const { data, error } = await supabase.rpc('get_other_branch_invoice_number_ranges_v1', {
        p_selected_branch: selectedBranch,
      });
      if (error || !data) return;
      const otherBranchRanges = new Map<string, { min: number; max: number; count: number }>();
      for (const row of data as Array<{ branch: string | null; min_invoice: number | string | null; max_invoice: number | string | null; invoice_count: number | string | null }>) {
        if (!row.branch) continue;
        const minValue = Number(row.min_invoice || 0);
        const maxValue = Number(row.max_invoice || 0);
        const countValue = Number(row.invoice_count || 0);
        if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || countValue <= 0) continue;
        otherBranchRanges.set(row.branch, { min: minValue, max: maxValue, count: countValue });
      }
"""
text = replace_once(text, old_branch, new_branch, "branch mismatch range RPC")
invoices.write_text(text, encoding="utf-8")

print("final performance patches prepared")
