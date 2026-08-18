#!/usr/bin/env node
/**
 * Phase 2: Parity Test
 * Verify 100% numeric match between OLD path (N+1) and NEW path (batch RPC)
 * Tests: 18, 36, 72 customer scenarios
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envLines = envContent.split('\n');
for (const line of envLines) {
  const match = line.match(/^([^#=]+)=(.+)$/);
  if (match) {
    const key = match[1].trim();
    const value = match[2].trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

// Helper functions (same as src/lib/customerServiceCustomerMetrics.ts)
function cleanText(value) {
  return String(value ?? '').trim();
}

function digitsOnly(value) {
  return cleanText(value).replace(/\D/g, '');
}

function lastPhoneDigits(value, count = 10) {
  const digits = digitsOnly(value);
  return digits.length > count ? digits.slice(-count) : digits;
}

function normalizeArabicName(value) {
  return cleanText(value)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = cleanText(value)
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[^0-9.\-]/g, '');
  const amount = Number(normalized || 0);
  return Number.isFinite(amount) ? amount : 0;
}

// OLD PATH: Current N+1 implementation
async function fetchByStrategiesOld(input) {
  const code = cleanText(input.customer_code);
  const phone = cleanText(input.customer_phone);
  const phoneTail = lastPhoneDigits(phone);
  const name = cleanText(input.customer_name);
  const allRows = [];

  const strategies = [];
  if (code) {
    strategies.push({
      label: 'code',
      columns: ['customer_code', 'client_code', 'code'],
      op: 'eq',
      value: code,
    });
  }
  if (phone) {
    strategies.push({
      label: 'phone',
      columns: ['customer_phone', 'phone', 'mobile', 'client_phone', 'whatsapp_phone'],
      op: 'eq',
      value: phone,
    });
  }
  if (phoneTail.length >= 8) {
    strategies.push({
      label: 'phoneTail',
      columns: ['customer_phone', 'phone', 'mobile', 'client_phone', 'whatsapp_phone'],
      op: 'ilike',
      value: `%${phoneTail}`,
    });
  }
  if (name && normalizeArabicName(name).length >= 3) {
    strategies.push({
      label: 'name',
      columns: ['customer_name', 'name', 'client_name'],
      op: 'ilike',
      value: `%${name}%`,
    });
  }

  for (const strategy of strategies) {
    for (const column of strategy.columns) {
      let query = supabase.from('sales_invoices').select('*').limit(700);
      if (strategy.op === 'eq') {
        query = query.eq(column, strategy.value);
      } else {
        query = query.ilike(column, strategy.value);
      }
      const { data, error } = await query;
      if (error || !data?.length) continue;

      let filteredRows = data;
      if (strategy.label === 'name' && phoneTail.length >= 8) {
        const phoneColumns = ['customer_phone', 'phone', 'mobile', 'client_phone', 'whatsapp_phone'];
        const phoneFiltered = data.filter((row) =>
          phoneColumns.some((col) => lastPhoneDigits(row[col]).endsWith(phoneTail))
        );
        if (phoneFiltered.length) filteredRows = phoneFiltered;
      }

      allRows.push(...filteredRows);
      if (strategy.label === 'code' || strategy.label === 'phone' || strategy.label === 'phoneTail') {
        return allRows;
      }
    }
    if (allRows.length && ['code', 'phone', 'phoneTail'].some((key) => strategies.some((s) => s.label === key))) {
      return allRows;
    }
  }
  return allRows;
}

async function summarizeInvoicesOld(rows, matchedBy) {
  const invoices = new Map();
  for (const row of rows) {
    const id = row.id || `${row.invoice_date}-${parseMoney(row.net_total || row.total_amount)}-${row.branch}`;
    invoices.set(id, row);
  }
  const uniqueRows = [...invoices.values()];
  const totals = uniqueRows.map((r) => parseMoney(r.net_total || r.total_amount || 0)).filter(Number.isFinite);
  const total = totals.reduce((sum, v) => sum + v, 0);
  
  const datedRows = uniqueRows
    .map((row) => ({
      row,
      date: row.invoice_date,
      amount: parseMoney(row.net_total || row.total_amount || 0),
      branch: row.branch,
    }))
    .filter((item) => item.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const dates = datedRows.map((item) => item.date);
  const months = new Set(dates.map((d) => d.slice(0, 7)));
  const now = new Date();
  const currentStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

  const currentMonthRows = datedRows.filter((item) => item.date >= currentStart && item.date <= currentEnd);
  const previousMonthRows = datedRows.filter((item) => item.date >= prevStart && item.date <= prevEnd);

  const branchCounts = new Map();
  const branchTotals = new Map();
  for (const item of datedRows) {
    if (!item.branch) continue;
    branchCounts.set(item.branch, (branchCounts.get(item.branch) || 0) + 1);
    branchTotals.set(item.branch, (branchTotals.get(item.branch) || 0) + item.amount);
  }

  const lastRow = datedRows.at(-1);
  const lastPurchase = dates.at(-1) || null;
  const invoicesCount = uniqueRows.length;
  const avgInvoice = invoicesCount ? total / invoicesCount : 0;
  const avgMonthly = months.size ? total / months.size : 0;

  const segmentCalculation = () => {
    if (total >= 8000 || invoicesCount >= 12) return 'VIP';
    if (total >= 4000 || invoicesCount >= 6) return 'Loyal';
    if (lastPurchase) {
      const daysSince = Math.floor((Date.now() - new Date(lastPurchase).getTime()) / 86_400_000);
      if (daysSince > 90) return 'At Risk';
    }
    return 'Occasional';
  };

  const statusCalculation = () => {
    if (!lastPurchase) return 'لا يوجد شراء';
    const days = Math.floor((Date.now() - new Date(lastPurchase).getTime()) / 86_400_000);
    if (days <= 45) return 'نشط';
    if (days <= 90) return 'يحتاج متابعة';
    return 'متوقف';
  };

  return {
    total_spent: total,
    invoices_count: invoicesCount,
    last_purchase: lastPurchase,
    first_purchase: dates[0] || null,
    avg_invoice: avgInvoice,
    avg_monthly: avgMonthly,
    current_month_count: currentMonthRows.length,
    current_month_spent: currentMonthRows.reduce((s, i) => s + i.amount, 0),
    previous_month_count: previousMonthRows.length,
    previous_month_spent: previousMonthRows.reduce((s, i) => s + i.amount, 0),
    average_monthly_purchase_count: months.size ? invoicesCount / months.size : currentMonthRows.length,
    branch: lastRow?.branch || [...branchCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    segment: segmentCalculation(),
    customer_status: statusCalculation(),
  };
}

async function getCustomerServiceLiveMetricsOld(input) {
  const rows = await fetchByStrategiesOld(input);
  if (!rows.length) return null;
  return await summarizeInvoicesOld(rows, 'old-path');
}

// NEW PATH: Batch RPC
async function getCustomerServiceMetricsBatchNew(customers) {
  const { data, error } = await supabase.rpc('get_customer_service_metrics_batch_v1', {
    p_customers: customers,
  });
  
  if (error) {
    console.error('RPC error:', error);
    return null;
  }
  return data;
}

// Main parity test
async function runParityTest(batchSize) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PARITY TEST: ${batchSize} customers`);
  console.log(`${'='.repeat(60)}\n`);

  // Fetch sample customers
  const { data: sampleRows, error: fetchError } = await supabase
    .from('customer_requests')
    .select('customer_id, customer_code, customer_phone, customer_name, branch')
    .limit(batchSize);

  if (fetchError || !sampleRows) {
    console.error('Failed to fetch customers:', fetchError);
    return null;
  }

  console.log(`Found ${sampleRows.length} customers to test`);

  const testCustomers = sampleRows.map((row) => ({
    customer_id: row.customer_id,
    customer_code: row.customer_code,
    customer_phone: row.customer_phone,
    customer_name: row.customer_name,
    branch: row.branch,
  }));

  // Run old path
  console.log(`\nRunning OLD path (N+1 queries)...`);
  const oldStart = Date.now();
  const oldResults = {};
  let oldQueryCount = 0;
  for (const cust of testCustomers) {
    const metrics = await getCustomerServiceLiveMetricsOld(cust);
    if (metrics) {
      oldResults[`${cust.customer_code}-${cust.customer_phone}-${cust.customer_name}`] = metrics;
      oldQueryCount += 1.5; // Approximate
    }
  }
  const oldDuration = Date.now() - oldStart;

  // Run new path
  console.log(`Running NEW path (batch RPC)...`);
  const newStart = Date.now();
  const newResultsArray = await getCustomerServiceMetricsBatchNew(testCustomers);
  const newDuration = Date.now() - newStart;
  const newQueryCount = 1; // Single RPC call

  const newResults = {};
  if (newResultsArray) {
    for (const row of newResultsArray) {
      const key = `${row.customer_code}-${row.customer_phone}-${row.customer_name}`;
      newResults[key] = row;
    }
  }

  // Compare results
  console.log(`\nOLD: ${oldDuration}ms (≈${oldQueryCount.toFixed(0)} queries)`);
  console.log(`NEW: ${newDuration}ms (${newQueryCount} query)\n`);

  let matches = 0;
  let mismatches = 0;
  const mismatchDetails = [];

  for (const key of Object.keys(oldResults)) {
    const old = oldResults[key];
    const newRow = newResults[key];

    if (!newRow) {
      console.log(`❌ MISSING in NEW: ${key}`);
      mismatches++;
      continue;
    }

    // Compare key metrics
    const fieldsToCheck = [
      'total_spent',
      'invoices_count',
      'last_purchase',
      'avg_invoice',
      'first_purchase',
      'avg_monthly',
      'current_month_count',
      'current_month_spent',
      'previous_month_count',
      'previous_month_spent',
      'segment',
      'customer_status',
    ];

    let rowMismatch = false;
    for (const field of fieldsToCheck) {
      const oldVal = old[field];
      const newVal = newRow[field];

      // Allow small numeric differences (rounding)
      let match = false;
      if (typeof oldVal === 'number' && typeof newVal === 'number') {
        match = Math.abs(oldVal - newVal) < 0.01;
      } else {
        match = oldVal === newVal;
      }

      if (!match) {
        rowMismatch = true;
        mismatchDetails.push({
          key,
          field,
          old: oldVal,
          new: newVal,
        });
      }
    }

    if (rowMismatch) {
      mismatches++;
      console.log(`❌ MISMATCH: ${key}`);
    } else {
      matches++;
    }
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Tested: ${Object.keys(oldResults).length} customers`);
  console.log(`Matches: ${matches} ✅`);
  console.log(`Mismatches: ${mismatches} ❌`);

  if (mismatchDetails.length > 0) {
    console.log(`\nMismatch details:`);
    for (const detail of mismatchDetails.slice(0, 10)) {
      console.log(`  ${detail.key} > ${detail.field}: ${detail.old} !== ${detail.new}`);
    }
  }

  return {
    batchSize,
    matches,
    mismatches,
    oldDuration,
    newDuration,
    oldQueryCount: Math.round(oldQueryCount),
    newQueryCount,
    improvement: ((oldDuration - newDuration) / oldDuration * 100).toFixed(1),
  };
}

// Main
async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║           PHASE 2: PARITY TEST - ALL BATCH SIZES            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const results = [];
  for (const size of [18, 36, 72]) {
    const result = await runParityTest(size);
    if (result) results.push(result);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY TABLE');
  console.log(`${'='.repeat(60)}\n`);

  console.table(results.map((r) => ({
    'Customers': r.batchSize,
    'Matches': r.matches,
    'Mismatches': r.mismatches,
    'Old (ms)': r.oldDuration,
    'New (ms)': r.newDuration,
    'Improvement %': r.improvement,
    'Old Queries': r.oldQueryCount,
    'New Queries': r.newQueryCount,
  })));

  // Final verdict
  const allMatch = results.every((r) => r.mismatches === 0);
  console.log(`\n${'-'.repeat(60)}`);
  if (allMatch) {
    console.log('✅ ALL TESTS PASSED: 100% NUMERIC PARITY ACHIEVED');
  } else {
    console.log('❌ PARITY FAILURE: Fix mismatches before integration');
  }
  console.log(`${'-'.repeat(60)}\n`);

  process.exit(allMatch ? 0 : 1);
}

main().catch(console.error);
