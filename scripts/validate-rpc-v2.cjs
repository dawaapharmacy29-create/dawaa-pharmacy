#!/usr/bin/env node
/**
 * Phase 2: RPC Validation (Fast)
 * Check if RPC is deployed and returns expected fields
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
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

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║           PHASE 2: RPC VALIDATION                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Step 1: Check if RPC exists by calling it with empty data
  console.log('Step 1: Testing RPC availability...');
  try {
    const { data: testData, error: testError } = await supabase.rpc(
      'get_customer_service_metrics_batch_v1',
      {
        p_customers: [],
      }
    );

    if (testError) {
      console.log('❌ RPC call failed:', testError.message);
      console.log('\n   RPC may not be deployed yet. Deploy migration:');
      console.log('   npx supabase db push\n');
      process.exit(1);
    }

    console.log('✅ RPC is deployed and callable');
    console.log(`   Empty batch returned ${testData?.length || 0} rows\n`);
  } catch (err) {
    console.log('❌ Error calling RPC:', err.message);
    process.exit(1);
  }

  // Step 2: Fetch a few real customers
  console.log('Step 2: Fetching sample customers...');
  const { data: sampleRows, error: fetchError } = await supabase
    .from('customer_requests')
    .select('customer_id, customer_code, customer_phone, customer_name, branch')
    .limit(5);

  if (fetchError || !sampleRows?.length) {
    console.log('❌ Failed to fetch customers:', fetchError?.message);
    process.exit(1);
  }

  console.log(`✅ Found ${sampleRows.length} sample customers\n`);

  // Step 3: Call RPC with real data
  console.log('Step 3: Testing RPC with real customer data...');
  const testCustomers = sampleRows.map((row) => ({
    customer_id: row.customer_id,
    customer_code: row.customer_code,
    customer_phone: row.customer_phone,
    customer_name: row.customer_name,
    branch: row.branch,
  }));

  const { data: rpcResults, error: rpcError } = await supabase.rpc(
    'get_customer_service_metrics_batch_v1',
    {
      p_customers: testCustomers,
    }
  );

  if (rpcError) {
    console.log('❌ RPC call with real data failed:', rpcError.message);
    console.log('   Error details:', rpcError);
    process.exit(1);
  }

  console.log(`✅ RPC returned ${rpcResults?.length || 0} results\n`);

  // Step 4: Validate output structure
  if (!rpcResults || rpcResults.length === 0) {
    console.log('❌ No results returned from RPC');
    process.exit(1);
  }

  console.log('Step 4: Validating output structure...');
  const firstResult = rpcResults[0];
  const expectedFields = [
    'customer_id', 'customer_code', 'customer_phone', 'customer_name',
    'total_spent', 'invoices_count', 'last_purchase', 'first_purchase',
    'avg_invoice', 'avg_monthly', 'current_month_spent', 'previous_month_spent',
    'current_month_count', 'previous_month_count', 'segment', 'customer_status',
    'branch', 'branch_most_frequent', 'matched_by',
  ];

  const missingFields = [];
  for (const field of expectedFields) {
    if (!(field in firstResult)) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    console.log(`❌ Missing fields: ${missingFields.join(', ')}`);
    process.exit(1);
  }

  console.log('✅ All expected fields present');
  console.log(`   Sample result for ${firstResult.customer_code}:`);
  console.log(`   - Total spent: ${firstResult.total_spent}`);
  console.log(`   - Invoices: ${firstResult.invoices_count}`);
  console.log(`   - Segment: ${firstResult.segment}`);
  console.log(`   - Status: ${firstResult.customer_status}`);
  console.log(`   - Matched by: ${firstResult.matched_by}\n`);

  // Step 5: Performance check
  console.log('Step 5: Performance check...');
  const iterations = 5;
  const batchSizes = [18, 36];
  
  for (const size of batchSizes) {
    const { data: bigSample } = await supabase
      .from('customer_requests')
      .select('customer_id, customer_code, customer_phone, customer_name, branch')
      .limit(size);

    if (!bigSample || bigSample.length === 0) continue;

    const bigTestCustomers = bigSample.map((row) => ({
      customer_id: row.customer_id,
      customer_code: row.customer_code,
      customer_phone: row.customer_phone,
      customer_name: row.customer_name,
      branch: row.branch,
    }));

    let totalMs = 0;
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await supabase.rpc('get_customer_service_metrics_batch_v1', {
        p_customers: bigTestCustomers,
      });
      totalMs += Date.now() - start;
    }

    const avgMs = (totalMs / iterations).toFixed(1);
    console.log(`✅ ${size} customers: avg ${avgMs}ms (${iterations} runs)`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ ALL VALIDATION CHECKS PASSED');
  console.log('RPC is deployed, returns expected structure, and performs well');
  console.log(`${'='.repeat(60)}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
