#!/usr/bin/env node
/**
 * Phase 2: Guided RPC Migration Deployment
 * Shows SQL to execute and waits for confirmation
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║       PHASE 2: GUIDED RPC MIGRATION DEPLOYMENT              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Read migration file
  const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260818_customer_service_metrics_batch_rpc_v1.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  console.log('📋 Migration to deploy:');
  console.log(`   File: ${path.basename(migrationPath)}`);
  console.log(`   Size: ${(sql.length / 1024).toFixed(1)} KB`);
  console.log(`   Lines: ${sql.split('\n').length}\n`);

  console.log('🔗 Supabase Project:');
  const url = new URL(process.env.VITE_SUPABASE_URL);
  const projectId = url.hostname.split('.')[0];
  console.log(`   Project ID: ${projectId}`);
  console.log(`   URL: ${process.env.VITE_SUPABASE_URL}\n`);

  console.log('📄 SQL Content Preview (first 30 lines):\n');
  const lines = sql.split('\n').slice(0, 30);
  for (const line of lines) {
    console.log(`   ${line}`);
  }
  if (sql.split('\n').length > 30) {
    console.log(`   ... (${sql.split('\n').length - 30} more lines)\n`);
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  HOW TO DEPLOY                                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('Option 1: Supabase Dashboard (RECOMMENDED for first-time)');
  console.log('   1. Go to: https://app.supabase.com/projects');
  console.log(`   2. Open project: ${projectId}`);
  console.log('   3. Click: SQL Editor (left sidebar)');
  console.log('   4. Click: New query');
  console.log('   5. Copy entire content of supabase/migrations/20260818_customer_service_metrics_batch_rpc_v1.sql');
  console.log('   6. Paste into editor');
  console.log('   7. Click: Run\n');

  console.log('Option 2: Supabase CLI');
  console.log('   1. Install: npm install -g @supabase/cli');
  console.log(`   2. Link project: npx supabase link --project-ref ${projectId}`);
  console.log('   3. Deploy: npx supabase db push\n');

  console.log('Option 3: Copy-paste SQL command');
  const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260818_customer_service_metrics_batch_rpc_v1.sql');
  console.log(`   cat ${sqlPath}`);
  console.log('   Then paste into Supabase SQL Editor\n');

  const choice = await question('Have you deployed the migration? (y/n): ');

  if (choice.toLowerCase() !== 'y') {
    console.log('\n❌ Deployment skipped.');
    console.log('Please deploy the migration and try again.\n');
    rl.close();
    process.exit(1);
  }

  console.log('\n⏳ Checking if RPC is deployed...\n');

  // Give time for propagation
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const { data: testData, error: testError } = await supabase.rpc(
      'get_customer_service_metrics_batch_v1',
      { p_customers: [] }
    );

    if (testError) {
      console.log('❌ RPC still not available:', testError.message);
      console.log('\n   Possible causes:');
      console.log('   - SQL has syntax errors');
      console.log('   - Deployment is still in progress');
      console.log('   - Need to wait a few seconds');
      console.log('\n   Please check Supabase dashboard for errors.\n');
      rl.close();
      process.exit(1);
    }

    console.log('✅ RPC is now deployed and working!');
    console.log(`   Function: get_customer_service_metrics_batch_v1`);
    console.log(`   Empty batch test: PASS\n`);

    rl.close();
    process.exit(0);
  } catch (err) {
    console.log('❌ Error:', err.message);
    rl.close();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  rl.close();
  process.exit(1);
});
