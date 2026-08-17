const fs = require('node:fs');

const filePath = 'src/lib/api/customers.ts';
let source = fs.readFileSync(filePath, 'utf8');

const startMarker = 'async function patchCustomerMetricsFromInvoices(customers: CustomerMetric[]) {';
const endMarker = '\nfunction applyBranchFilter';
const helperImport = `import {\n  fetchCustomerInvoiceMetricsPatch,\n  type CustomerInvoiceMetricPatchRow,\n} from '@/lib/api/customerInvoiceMetricsPatch';\n`;
const helperImportAnchor = "import type { CustomerMetric as CustomerMetricType, CustomerLike } from '@/types/domain';";
const verificationMarker = 'fetchCustomerInvoiceMetricsPatch(codes)';

if (source.includes(verificationMarker)) {
  console.log('Customer invoice metrics RPC already wired.');
  process.exit(0);
}

if (!source.includes(helperImport)) {
  if (!source.includes(helperImportAnchor)) {
    throw new Error('Could not locate customer metrics import anchor safely. Refusing to patch.');
  }
  source = source.replace(helperImportAnchor, `${helperImport}\n${helperImportAnchor}`);
}

const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0 || end <= start) {
  throw new Error('Could not locate patchCustomerMetricsFromInvoices safely. Refusing to patch.');
}

const replacement = `async function patchCustomerMetricsFromInvoices(customers: CustomerMetric[]) {
  const codes = [
    ...new Set(
      customers.map((customer) => String(customer.customer_code || '').trim()).filter(Boolean)
    ),
  ];
  if (!codes.length) return customers;

  const applyAggregates = (
    rows: CustomerInvoiceMetricPatchRow[]
  ) => {
    const aggregates = new Map<string, CustomerInvoiceMetricPatchRow>();
    for (const row of rows) {
      const code = String(row.customer_code || '').trim();
      if (code) aggregates.set(code, row);
    }

    return customers.map((customer) => {
      const aggregate = aggregates.get(String(customer.customer_code || '').trim());
      if (!aggregate) return customer;
      const aggregateCount = toNumber(aggregate.invoices_count);
      const aggregateTotal = toNumber(aggregate.total_spent);
      const aggregateMonths = toNumber(aggregate.active_months);
      const invoicesCount = Math.max(customer.invoices_count || 0, aggregateCount);
      const totalSpent = Math.max(customer.total_spent || 0, aggregateTotal);
      const patched: CustomerMetric = {
        ...customer,
        invoices_count: invoicesCount,
        total_spent: totalSpent,
        total_purchases: totalSpent,
        avg_invoice:
          invoicesCount > 0
            ? Math.max(customer.avg_invoice || 0, totalSpent / invoicesCount)
            : customer.avg_invoice,
        first_purchase: isBeforeDate(aggregate.first_purchase, customer.first_purchase)
          ? aggregate.first_purchase || null
          : customer.first_purchase,
        last_purchase: isAfterDate(aggregate.last_purchase, customer.last_purchase)
          ? aggregate.last_purchase || null
          : customer.last_purchase,
        active_months: Math.max(customer.active_months || 0, aggregateMonths),
      };
      return normalizeMetricAfterInvoicePatch(patched);
    });
  };

  // Fast path: aggregate inside Postgres so the customer list does not download
  // thousands of invoice rows just to rebuild metrics already available server-side.
  const rpcData = await fetchCustomerInvoiceMetricsPatch(codes);
  if (rpcData && rpcData.length) {
    return applyAggregates(rpcData);
  }

  // Safety fallback: preserve the legacy raw-invoice path if the RPC is temporarily
  // unavailable. This keeps the customer page resilient during partial deployments.
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('id,customer_code,invoice_date,net_amount,discounted_amount,amount,gross_amount')
    .in('customer_code', codes)
    .limit(10000);

  if (error || !data?.length) return customers;

  const rawAggregates = new Map<
    string,
    { count: number; total: number; first: string | null; last: string | null; months: Set<string> }
  >();
  for (const row of (data || []) as Row[]) {
    const code = String(readFirst(row, ['customer_code'], '') || '').trim();
    if (!code) continue;
    const invoiceDate = dateOnly(readFirst(row, ['invoice_date'], null) as string | null);
    const current = rawAggregates.get(code) || {
      count: 0,
      total: 0,
      first: null,
      last: null,
      months: new Set<string>(),
    };
    current.count += 1;
    current.total += toNumber(
      readFirst(row, ['net_amount', 'discounted_amount', 'amount', 'gross_amount'], 0)
    );
    if (invoiceDate) {
      if (isBeforeDate(invoiceDate, current.first)) current.first = invoiceDate;
      if (isAfterDate(invoiceDate, current.last)) current.last = invoiceDate;
      current.months.add(invoiceDate.slice(0, 7));
    }
    rawAggregates.set(code, current);
  }

  return applyAggregates(
    [...rawAggregates.entries()].map(([customer_code, aggregate]) => ({
      customer_code,
      invoices_count: aggregate.count,
      total_spent: aggregate.total,
      first_purchase: aggregate.first,
      last_purchase: aggregate.last,
      active_months: aggregate.months.size,
    }))
  );
}
`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(filePath, source);
console.log('Customer invoice metrics RPC wired with raw fallback.');
