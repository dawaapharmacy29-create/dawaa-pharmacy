#!/usr/bin/env node
/**
 * Deploy RPC migration directly
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
  process.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
    },
  }
);

async function main() {
  console.log('\n📦 Deploying RPC migration...\n');

  // Read the migration file
  const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260818_customer_service_metrics_batch_rpc_v1.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  try {
    // Execute the SQL as a database function call
    // We need to use the rpc method, but first we need to connect as a service role
    // Since we only have anon key, we need to execute via SQL
    
    console.log('Executing RPC migration SQL...');
    console.log(`File: ${path.basename(migrationPath)}`);
    console.log(`Size: ${(sql.length / 1024).toFixed(1)} KB\n`);

    // For now, print instructions since we can't execute raw SQL with anon key
    console.log('⚠️  Cannot execute migration with anon key.');
    console.log('\n   Please execute via Supabase dashboard or CLI:\n');
    console.log('   Option 1: Supabase Dashboard');
    console.log('   - Go to SQL Editor');
    console.log('   - Create new query');
    console.log('   - Copy content of supabase/migrations/20260818_customer_service_metrics_batch_rpc_v1.sql');
    console.log('   - Execute\n');
    console.log('   Option 2: Supabase CLI (after linking)');
    console.log('   $ npx supabase link');
    console.log('   $ npx supabase db push\n');
    console.log('   Option 3: psql');
    console.log('   $ psql postgresql://postgres:PASSWORD@db.PROJECTID.supabase.co:5432/postgres < supabase/migrations/20260818_customer_service_metrics_batch_rpc_v1.sql\n');

    // Try to get connection details from env
    const url = new URL(process.env.VITE_SUPABASE_URL);
    const projectId = url.hostname.split('.')[0];
    console.log(`   Project ID: ${projectId}`);
    console.log(`   URL: ${process.env.VITE_SUPABASE_URL}\n`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
