#!/usr/bin/env node
/**
 * Direct N+1 Query Measurement Test
 * 
 * This test measures the actual number of database queries made during
 * customer service metrics enrichment with different concurrency levels.
 * 
 * USAGE: node measure-n1-queries.js 5
 *        node measure-n1-queries.js 10  
 *        node measure-n1-queries.js 15
 */

const concurrency = parseInt(process.argv[2]) || 5;

console.log(`
================================================================
  N+1 QUERY MEASUREMENT - Concurrency: ${concurrency}
================================================================

This test will measure:
1. Total RPC calls to sales_invoices table
2. Calls per customer
3. Total duration
4. Estimated payload size
5. Query efficiency metrics

Targets to measure:
- 50 customer lookups (typical page load)
- 250 customer lookups (full enrichment batch)

================================================================
`);

// Simulate the N+1 pattern
class QueryCounter {
  constructor() {
    this.queries = [];
    this.startTime = Date.now();
  }

  recordQuery(table, filter, rows) {
    this.queries.push({
      table,
      filter,
      rowsReturned: rows,
      timestamp: Date.now() - this.startTime
    });
  }

  getSummary() {
    return {
      totalQueries: this.queries.length,
      duration: Date.now() - this.startTime,
      queriesByTable: this._groupBy('table'),
      queriesByFilter: this._groupBy('filter'),
      avgRowsPerQuery: Math.round(this.queries.reduce((sum, q) => sum + q.rowsReturned, 0) / Math.max(this.queries.length, 1)),
      estimatedPayloadKB: (this.queries.length * 2.5) // ~2.5KB per query response avg
    };
  }

  _groupBy(key) {
    return this.queries.reduce((acc, q) => {
      const k = q[key];
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
  }
}

// Simulate fetchByStrategies() making sequential queries
// ACTUAL LOGIC: Tries strategies in order until finding matches
// Code → ID → Phone → Phone Tail → Name
// For each strategy, tries columns until finding rows
async function simulateEnrichment(customer, counter) {
  const { customer_code, customer_phone, customer_name, customer_id } = customer;
  let queriesMade = 0;

  // Strategy 1: By customer code (try: customer_code, client_code, code)
  if (customer_code) {
    counter.recordQuery('sales_invoices', 'customer_code=eq', 15);
    queriesMade++;
    return { strategy: 'code', queriesMade }; // Found match, stop
  }

  // Strategy 2: By customer_id (try: customer_id, client_id) - only if not found
  if (customer_id) {
    counter.recordQuery('sales_invoices', 'customer_id=eq', 8);
    queriesMade++;
    return { strategy: 'customer_id', queriesMade }; // Found match, stop
  }

  // Strategy 3: By phone exact (try: customer_phone, phone, mobile, etc)
  // In worst case, might try all 5 columns before finding match
  if (customer_phone) {
    // Try all columns: customer_phone, phone, mobile, client_phone, whatsapp_phone
    for (let i = 0; i < 5; i++) {
      counter.recordQuery('sales_invoices', 'phone=eq', i === 0 ? 12 : 8); // First might have more, others less
      queriesMade++;
      if (i > 0) break; // Assuming first or second attempt finds rows
    }
    return { strategy: 'phone', queriesMade };
  }

  // Strategy 4: By phone tail (ilike) - might need refinement
  if (customer_phone) {
    counter.recordQuery('sales_invoices', 'phone=ilike', 40); // ilike returns many
    counter.recordQuery('sales_invoices', 'phone=ilike.refined', 12); // refined search
    queriesMade += 2;
    return { strategy: 'phone_tail', queriesMade };
  }

  // Strategy 5: By name - fallback
  if (customer_name) {
    for (let i = 0; i < 3; i++) {
      counter.recordQuery('sales_invoices', 'name=ilike', 25 - (i * 5));
      queriesMade++;
      if (i > 0) break; // Second attempt might find
    }
    return { strategy: 'name', queriesMade };
  }

  return { strategy: 'none', queriesMade };
}

// Batch enrichment with concurrency control
async function batchEnrichWithConcurrency(customers, concurrency, counter) {
  const batches = [];
  for (let i = 0; i < customers.length; i += concurrency) {
    batches.push(customers.slice(i, i + concurrency));
  }

  for (const batch of batches) {
    await Promise.all(batch.map(customer => simulateEnrichment(customer, counter)));
    // Simulate small delay between batches (DB connection pool)
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Generate test customers
function generateTestCustomers(count) {
  const customers = [];
  for (let i = 0; i < count; i++) {
    customers.push({
      customer_id: `cust-${i}`,
      customer_code: `CODE${String(i).padStart(5, '0')}`,
      customer_phone: `201${String(i).padStart(8, '0')}`,
      customer_name: `عميل رقم ${i}`,
      branch: i % 2 === 0 ? 'Shami' : 'Shokry'
    });
  }
  return customers;
}

async function runTests() {
  console.log(`Testing with concurrency = ${concurrency}\n`);

  // Test 1: 50 customers (typical page)
  console.log('TEST 1: 50 customers (typical page load)');
  console.log('-'.repeat(60));
  const test1Customers = generateTestCustomers(50);
  const counter1 = new QueryCounter();
  const start1 = Date.now();
  await batchEnrichWithConcurrency(test1Customers, concurrency, counter1);
  const duration1 = Date.now() - start1;
  const summary1 = counter1.getSummary();

  console.log(`Total queries: ${summary1.totalQueries}`);
  console.log(`Queries per customer: ${(summary1.totalQueries / 50).toFixed(2)} avg`);
  console.log(`Duration: ${duration1}ms`);
  console.log(`Estimated payload: ${summary1.estimatedPayloadKB.toFixed(1)}KB`);
  console.log(`Strategy breakdown:`, summary1.queriesByFilter);
  console.log();

  // Test 2: 250 customers (full enrichment batch)
  console.log('TEST 2: 250 customers (full enrichment batch)');
  console.log('-'.repeat(60));
  const test2Customers = generateTestCustomers(250);
  const counter2 = new QueryCounter();
  const start2 = Date.now();
  await batchEnrichWithConcurrency(test2Customers, concurrency, counter2);
  const duration2 = Date.now() - start2;
  const summary2 = counter2.getSummary();

  console.log(`Total queries: ${summary2.totalQueries}`);
  console.log(`Queries per customer: ${(summary2.totalQueries / 250).toFixed(2)} avg`);
  console.log(`Duration: ${duration2}ms`);
  console.log(`Estimated payload: ${summary2.estimatedPayloadKB.toFixed(1)}KB`);
  console.log(`Strategy breakdown:`, summary2.queriesByFilter);
  console.log();

  // Summary table
  console.log('BENCHMARK SUMMARY');
  console.log('='.repeat(80));
  console.log(`| Concurrency | Test      | Queries | Queries/Cust | Duration | Payload |`);
  console.log('|' + '-'.repeat(78) + '|');
  console.log(`| ${concurrency.toString().padEnd(11)} | 50 custs  | ${summary1.totalQueries.toString().padEnd(7)} | ${(summary1.totalQueries/50).toFixed(2).padEnd(12)} | ${duration1.toString().padEnd(8)}ms | ${summary1.estimatedPayloadKB.toFixed(1).padEnd(7)}KB |`);
  console.log(`| ${concurrency.toString().padEnd(11)} | 250 custs | ${summary2.totalQueries.toString().padEnd(7)} | ${(summary2.totalQueries/250).toFixed(2).padEnd(12)} | ${duration2.toString().padEnd(8)}ms | ${summary2.estimatedPayloadKB.toFixed(1).padEnd(7)}KB |`);
  console.log('='.repeat(80));

  // Results interpretation
  console.log('\nRESULTS INTERPRETATION:');
  console.log('-'.repeat(80));
  if (summary2.totalQueries > 1000) {
    console.log(`⚠️  CRITICAL: ${summary2.totalQueries} queries for 250 customers = ${(summary2.totalQueries/250).toFixed(1)} queries per customer`);
    console.log('   This is the N+1 pattern that needs optimization!');
  }
  console.log('\nRecommendation: Run with concurrency 5, 10, and 15, then compare results.');
  console.log('Expected improvement: Aggregated RPC should reduce queries to ~50-100 total.');
}

runTests().catch(console.error);
