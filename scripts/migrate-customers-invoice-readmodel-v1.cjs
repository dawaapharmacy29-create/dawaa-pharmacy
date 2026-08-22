#!/usr/bin/env node
const fs = require('node:fs');

const customersFile = 'src/lib/api/customers.ts';
const boundaryFile = 'scripts/check-data-access-boundaries.cjs';
let source = fs.readFileSync(customersFile, 'utf8');

const importAnchor = "import { buildCustomerFlagsForDb, parseCustomerFlags } from '@/lib/customerFlags';";
if (!source.includes("readCustomerInvoiceAggregatesByCodes")) {
  if (!source.includes(importAnchor)) throw new Error('customers import anchor not found');
  source = source.replace(importAnchor, `${importAnchor}\nimport { readCustomerInvoiceAggregatesByCodes } from '@/lib/readModels/customerInvoiceReadModel';`);
}

const start = source.indexOf('async function patchCustomerMetricsFromInvoices(customers: CustomerMetric[]) {');
const endAnchor = '\nfunction applyBranchFilter<T>';
const end = source.indexOf(endAnchor, start);
if (start < 0 || end < 0) throw new Error('patchCustomerMetricsFromInvoices block not found');

const replacement = `async function patchCustomerMetricsFromInvoices(customers: CustomerMetric[]) {\n  const codes = [\n    ...new Set(\n      customers.map((customer) => String(customer.customer_code || '').trim()).filter(Boolean)\n    ),\n  ];\n  if (!codes.length) return customers;\n\n  let aggregates;\n  try {\n    aggregates = await readCustomerInvoiceAggregatesByCodes(codes);\n  } catch (error) {\n    if (import.meta.env.DEV) {\n      console.warn('[customers] invoice aggregate patch skipped', error);\n    }\n    return customers;\n  }\n  if (!aggregates.size) return customers;\n\n  return customers.map((customer) => {\n    const aggregate = aggregates.get(String(customer.customer_code || '').trim());\n    if (!aggregate) return customer;\n    const invoicesCount = Math.max(customer.invoices_count || 0, aggregate.count);\n    const totalSpent = Math.max(customer.total_spent || 0, aggregate.total);\n    const patched: CustomerMetric = {\n      ...customer,\n      invoices_count: invoicesCount,\n      total_spent: totalSpent,\n      total_purchases: totalSpent,\n      avg_invoice:\n        invoicesCount > 0\n          ? Math.max(customer.avg_invoice || 0, totalSpent / invoicesCount)\n          : customer.avg_invoice,\n      first_purchase: isBeforeDate(aggregate.first, customer.first_purchase)\n        ? aggregate.first\n        : customer.first_purchase,\n      last_purchase: isAfterDate(aggregate.last, customer.last_purchase)\n        ? aggregate.last\n        : customer.last_purchase,\n      active_months: Math.max(customer.active_months || 0, aggregate.activeMonths),\n    };\n    return normalizeMetricAfterInvoicePatch(patched);\n  });\n}\n`;
source = source.slice(0, start) + replacement + source.slice(end);

if (/\.from\(\s*['\"]sales_invoices['\"]\s*\)/.test(source)) {
  throw new Error('customers.ts still has direct sales_invoices access after migration');
}
fs.writeFileSync(customersFile, source);

let boundary = fs.readFileSync(boundaryFile, 'utf8');
boundary = boundary.replace("  'src/lib/api/customers.ts',\n", '');
fs.writeFileSync(boundaryFile, boundary);
console.log('[customers-invoice-readmodel] migrated customers API and legacy debt register');
