import {
  getCustomerDetails,
  getCustomers,
  type CustomerMetric,
  type GetCustomersOptions,
} from '@/lib/api/customers';
import { isValidEgyptPhone } from '@/lib/customerAnalyticsService';
import { getCustomerFullProfile } from '@/lib/customerProfileService';

type Row = Record<string, unknown>;

export async function getCustomerSummary(options: GetCustomersOptions = {}) {
  return getCustomers(options);
}

export async function getCustomerFullMetricsProfile(customer: CustomerMetric) {
  const [details, fullProfile] = await Promise.all([
    getCustomerDetails(customer),
    getCustomerFullProfile({
      customer_id: customer.customer_id,
      customer_code: customer.customer_code,
      final_customer_key: customer.final_customer_key,
      customer_phone: customer.customer_phone,
      customer_name: customer.customer_name,
    }),
  ]);

  return { details, fullProfile };
}

export async function getCustomerLatestInvoices(customer: CustomerMetric, limit = 20) {
  return (await getCustomerDetails(customer, limit)).invoices;
}

export function getCustomersWithoutValidPhones(
  rows: Array<Pick<CustomerMetric, 'customer_phone' | 'phone' | 'customer_code'>>
) {
  return rows.filter(
    (row) => !isValidEgyptPhone(row.customer_phone || row.phone, row.customer_code)
  );
}

export function getCustomerLinkingHealth(rows: Row[]) {
  const missingCode = rows.filter((row) => !row.customer_code).length;
  const missingPhone = rows.filter((row) => !row.customer_phone && !row.phone).length;
  const pseudoCustomers = rows.filter(
    (row) =>
      String(row.customer_name || '').includes('عميل غير مسجل') ||
      String(row.customer_phone || row.phone || '').startsWith('code:')
  ).length;

  return {
    missingCode,
    missingPhone,
    pseudoCustomers,
    warnings: [
      missingCode ? `${missingCode} سجل بدون كود عميل واضح.` : '',
      missingPhone ? `${missingPhone} سجل بدون رقم صالح للواتساب.` : '',
      pseudoCustomers ? `${pseudoCustomers} سجل يستخدم عميل افتراضي أو phone=code.` : '',
    ].filter(Boolean),
  };
}
