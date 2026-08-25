const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

function latestContaining(needle) {
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const full = path.join(migrationsDir, files[i]);
    const text = fs.readFileSync(full, 'utf8');
    if (text.includes(needle)) return { file: files[i], text };
  }
  throw new Error(`Missing migration definition for ${needle}`);
}

function fail(message) {
  console.error(`[sales-truth-guard] ${message}`);
  process.exit(1);
}

const sales = latestContaining('create or replace view public.dawaa_sales_invoices_dashboard_v1');
const salesFn = latestContaining('create or replace function public.dawaa_is_sales_target_excluded_customer_v1');
const customer = latestContaining('create or replace view public.dawaa_customer_sales_analytics_v1');
const doctorMetrics = latestContaining('create or replace function public.refresh_doctor_metrics_daily');

const six = ['5', '10', '54', '170', '4902', '12820'];
for (const code of six) {
  if (!sales.text.includes(`'${code}'`) && !salesFn.text.includes(`'${code}'`)) {
    fail(`explicit sales exclusion code ${code} missing from latest policy`);
  }
}

if (/wholesale_b2b/.test(sales.text) || /wholesale_b2b/.test(salesFn.text)) {
  fail(`wholesale_b2b leaked back into branch/target sales truth (${sales.file} / ${salesFn.file})`);
}
if (/system_generic_code/.test(sales.text) || /system_generic_code/.test(salesFn.text)) {
  fail(`system_generic_code category leaked back into branch/target sales truth`);
}
if (!/wholesale_b2b/.test(customer.text) || !/system_generic_code/.test(customer.text)) {
  fail(`customer analytics truth must keep wholesale_b2b + system_generic_code exclusions (${customer.file})`);
}
if (!/dawaa_sales_invoices_dashboard_v1/.test(doctorMetrics.text)) {
  fail(`doctor metrics must read canonical sales truth (${doctorMetrics.file})`);
}
if (/from\s+public\.sales_invoices\b/i.test(doctorMetrics.text)) {
  fail(`doctor metrics regressed to raw sales_invoices (${doctorMetrics.file})`);
}

console.log('[sales-truth-guard] OK: sales, doctor, and customer analytics truth remain separated.');
