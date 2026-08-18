# Phase 2: Implementation Guide - Batch RPC Metrics Aggregation

**Status**: SPECIFICATION FOR IMPLEMENTATION  
**Target**: Complete metrics aggregation logic in get_customer_service_metrics_batch_v1()  
**Baseline**: 376-382 queries (264ms) → Target: 1-2 queries (<50ms)

---

## Overview

The migration file `20260818_customer_service_metrics_batch_rpc_v1.sql` has been created with:
- ✅ RPC function signature defined
- ✅ Input/output schema validated
- ✅ Placeholder implementation ready for extension
- ⏳ Metrics aggregation logic (TODO - this guide)

---

## SQL Metrics Aggregation Logic (To Implement)

### Current JavaScript Implementation (Reference)

The JS function `summarizeInvoices()` calculates:

```javascript
// Input: array of invoice rows matching the customer

// Deduplication by invoice identity
const invoices = new Map<string, InvoiceLike>();
for (const row of rows) {
  invoices.set(invoiceIdentity(row), row);  // invoiceIdentity = id or date-amount-branch
}

// Calculate all metrics from uniqueRows
const uniqueRows = [...invoices.values()];

// Financial: total, avg per invoice
const totals = uniqueRows.map(invoiceAmount).filter(Number.isFinite);
const total = totals.reduce((sum, value) => sum + value, 0);
const invoicesCount = uniqueRows.length;
const avgInvoice = invoicesCount ? total / invoicesCount : 0;

// Temporal: dates, months, monthly average
const dates = datedRows.map((item) => item.date as string);  // sorted
const months = new Set(dates.map((date) => date.slice(0, 7)));
const avgMonthly = months.size ? total / months.size : 0;

// Current/Previous month analysis
const currentMonthRows = datedRows.filter(item => within_current_month);
const previousMonthRows = datedRows.filter(item => within_previous_month);
const current_month_count = currentMonthRows.length;
const previous_month_count = previousMonthRows.length;

// Branch analysis
const branchCounts = new Map<string, number>();
const branchTotals = new Map<string, number>();
for (const item of datedRows) {
  branchCounts.set(branch, count + 1);
  branchTotals.set(branch, total + amount);
}
const branchMostFrequent = sort by count DESC, pick first
const branchHighestValue = sort by total DESC, pick first
const lastPurchaseRow = datedRows.at(-1);
const lastPurchase = dates.at(-1) || null;

// Segmentation
segment = segmentFrom(total, invoicesCount, lastPurchase);  // VIP if >=8000 OR >=12 invoices
status = statusFrom(lastPurchase);  // Based on days since last purchase
```

### SQL Implementation Pattern

```sql
-- For each matched customer, aggregate:

-- 1. Deduplication (same as JS invoiceIdentity)
--    Deduplicate by: coalesce(invoice_id, date || amount || branch)
--    Store unique invoice rows only

-- 2. Financial metrics
--    total_spent = SUM(get_invoice_amount(row))
--    invoices_count = COUNT(*)
--    avg_invoice = CASE WHEN invoices_count > 0 THEN total_spent / invoices_count ELSE 0 END

-- 3. Temporal metrics (date fields as ISO dates)
--    last_purchase = MAX(invoice_date)
--    first_purchase = MIN(invoice_date)
--    active_months = COUNT(DISTINCT date_trunc('month', invoice_date))
--    avg_monthly = CASE WHEN active_months > 0 THEN total_spent / active_months ELSE 0 END

-- 4. Monthly breakdown (current/previous month)
--    current_month = date_part('year', now()) = year AND date_part('month', now()) = month
--    previous_month = (current_month - 1 month)
--    Aggregate amounts/counts for each period

-- 5. Branch analysis (aggregation per branch, then extract top)
--    Group by branch, calculate count and sum per branch
--    branch_most_frequent = MAX by COUNT (most invoices)
--    branch_highest_value = MAX by SUM (highest total spent)
--    branch_last_purchase = branch of last_purchase row
--    branch = branch_last_purchase OR branch_most_frequent (fallback)

-- 6. Segmentation
--    segment = CASE
--      WHEN total_spent >= 8000 OR invoices_count >= 12 THEN 'VIP'
--      WHEN total_spent >= 4000 OR invoices_count >= 6 THEN 'Loyal'
--      WHEN days_since_last > 90 THEN 'At Risk'
--      ELSE 'Occasional'
--    END

-- 7. Customer status
--    status = CASE
--      WHEN last_purchase IS NULL THEN 'لا يوجد شراء'
--      WHEN days <= 45 THEN 'نشط'
--      WHEN days <= 90 THEN 'يحتاج متابعة'
--      ELSE 'متوقف'
--    END
```

---

## Implementation Steps (For Developer)

### Step 1: Replace Placeholder in RPC

In the `get_customer_service_metrics_batch_v1()` function, replace:

```sql
-- Aggregate metrics from matched invoices
-- (This will be implemented in next step)
-- For now, return result row
```

With a WITH clause that:

```sql
WITH invoice_rows AS (
  -- Convert matched invoices from array back to result set
  SELECT * FROM unnest(v_matching_invoices) AS ...
),
deduplicated AS (
  -- Deduplication by invoice_id or date-amount-branch
  SELECT DISTINCT ON (coalesce(id, date || amount || branch)) *
  FROM invoice_rows
),
aggregated AS (
  -- Calculate all metrics in one query
  SELECT
    total_spent,
    invoices_count,
    avg_invoice,
    avg_monthly,
    current_month_spent,
    current_month_count,
    previous_month_spent,
    previous_month_count,
    first_purchase,
    last_purchase,
    average_monthly_purchase_count,
    branch,
    branch_most_frequent,
    branch_highest_value,
    branch_last_purchase,
    segment,
    customer_status
  FROM (
    -- Main aggregation query (see below)
  )
)
SELECT ... FROM aggregated
```

### Step 2: Implement Core Aggregation Query

```sql
SELECT
  -- Financial
  COALESCE(SUM(get_invoice_amount(si.*)), 0) as total_spent,
  COUNT(*) as invoices_count,
  CASE WHEN COUNT(*) > 0 
    THEN COALESCE(SUM(get_invoice_amount(si.*)), 0) / COUNT(*) 
    ELSE 0 
  END as avg_invoice,
  
  -- Temporal
  MIN(si.invoice_date) as first_purchase,
  MAX(si.invoice_date) as last_purchase,
  COUNT(DISTINCT DATE_TRUNC('month', si.invoice_date::timestamp))::numeric as active_months,
  CASE 
    WHEN COUNT(DISTINCT DATE_TRUNC('month', si.invoice_date::timestamp)) > 0
      THEN COALESCE(SUM(get_invoice_amount(si.*)), 0) / 
           COUNT(DISTINCT DATE_TRUNC('month', si.invoice_date::timestamp))::numeric
    ELSE 0
  END as avg_monthly,
  
  -- Month analysis
  COALESCE(
    SUM(get_invoice_amount(si.*)) FILTER (
      WHERE DATE_TRUNC('month', si.invoice_date::timestamp) = DATE_TRUNC('month', NOW())
    ), 0
  ) as current_month_spent,
  COUNT(*) FILTER (
    WHERE DATE_TRUNC('month', si.invoice_date::timestamp) = DATE_TRUNC('month', NOW())
  ) as current_month_count,
  COALESCE(
    SUM(get_invoice_amount(si.*)) FILTER (
      WHERE DATE_TRUNC('month', si.invoice_date::timestamp) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')
    ), 0
  ) as previous_month_spent,
  COUNT(*) FILTER (
    WHERE DATE_TRUNC('month', si.invoice_date::timestamp) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')
  ) as previous_month_count,
  
  -- Branch analysis (use window functions or CTE)
  -- (See branch aggregation sub-section below)
  
  -- Segment & Status (derived fields)
  CASE
    WHEN COALESCE(SUM(get_invoice_amount(si.*)), 0) >= 8000 OR COUNT(*) >= 12 THEN 'VIP'
    WHEN COALESCE(SUM(get_invoice_amount(si.*)), 0) >= 4000 OR COUNT(*) >= 6 THEN 'Loyal'
    WHEN EXTRACT(DAY FROM (NOW()::date - MAX(si.invoice_date)::date)) > 90 THEN 'At Risk'
    ELSE 'Occasional'
  END as segment,
  
  CASE
    WHEN COUNT(*) = 0 OR MAX(si.invoice_date) IS NULL THEN 'لا يوجد شراء'
    WHEN EXTRACT(DAY FROM (NOW()::date - MAX(si.invoice_date)::date)) <= 45 THEN 'نشط'
    WHEN EXTRACT(DAY FROM (NOW()::date - MAX(si.invoice_date)::date)) <= 90 THEN 'يحتاج متابعة'
    ELSE 'متوقف'
  END as customer_status
  
FROM deduplicated si
```

### Step 3: Branch Aggregation Sub-Query

```sql
-- Branch metrics require additional aggregation
-- Use sub-select or window function approach

-- Option A: Sub-selects (clearest)
(SELECT branch FROM branch_summary ORDER BY count DESC LIMIT 1) as branch_most_frequent,
(SELECT branch FROM branch_summary ORDER BY total DESC LIMIT 1) as branch_highest_value,
(SELECT branch FROM deduplicated WHERE invoice_date = MAX(deduplicated.invoice_date)) as branch_last_purchase

-- Option B: Window functions with FIRST_VALUE (more efficient)
FIRST_VALUE(branch) OVER (ORDER BY branch_count DESC) as branch_most_frequent,
FIRST_VALUE(branch) OVER (ORDER BY branch_total DESC) as branch_highest_value,
FIRST_VALUE(branch) OVER (ORDER BY invoice_date DESC) as branch_last_purchase

-- Where branch_count and branch_total are calculated as:
COUNT(*) OVER (PARTITION BY si.branch) as branch_count
SUM(get_invoice_amount(si.*)) OVER (PARTITION BY si.branch) as branch_total
```

---

## Numeric Parity Validation

### Test Data Requirements

Create test script: `scripts/measure-phase2-parity.cjs`

```javascript
// Test 50+ customers with:
// - High-volume (>50 invoices)
// - Medium-volume (5-50 invoices)  
// - Low-volume (1-4 invoices)
// - No invoices
// - Various matching strategies (code/uuid/phone/name)
// - Multi-branch customers
// - Phone formatting variants
// - Arabic name variants

// Compare for each customer:
for each (customer) {
  OLD = current fetchByStrategies() + summarizeInvoices()
  NEW = get_customer_service_metrics_batch_v1(jsonb array)
  
  assert OLD.total_spent === NEW.total_spent
  assert OLD.invoices_count === NEW.invoices_count
  assert OLD.last_purchase === NEW.last_purchase
  assert OLD.avg_invoice === NEW.avg_invoice
  // ... all 20 fields
}
```

---

## Branch Isolation Implementation

### Requirement
If input includes `branch`, prefer that branch's data over cross-branch:

```sql
-- Add branch scoping to matching strategies:

-- STRATEGY 1: Code match WITH branch preference
WHERE (code matching) 
  AND (branch IS NULL OR branch = p_branch_input OR branch = (SELECT branch FROM branch_preference))

-- This ensures code matches don't pull data from wrong branch if branch specified
```

---

## Performance Benchmarking Strategy

### Baseline (Phase 1)
- Requests: 376-382
- Duration: 264ms
- Path: 15 concurrent per-customer queries

### Target (Phase 2)
- Requests: 1-2 (batch RPC + maybe fallback)
- Duration: <50ms
- Path: Single RPC call with array input

### Benchmark Script: `scripts/measure-phase2-batch.cjs`

```javascript
// 1. Measure OLD path (N+1 with concurrency=15)
OLD_START = now()
for (chunk of batches of 15) {
  for (customer of chunk) {
    await getCustomerServiceLiveMetrics(customer)  // One query per customer
  }
}
OLD_DURATION = now() - OLD_START
OLD_QUERIES = 376-382

// 2. Measure NEW path (batch RPC)
NEW_START = now()
const results = await supabase.rpc('get_customer_service_metrics_batch_v1', {
  p_customers: [all 250 customers as jsonb array]
})
NEW_DURATION = now() - NEW_START
NEW_QUERIES = 1-2 (one call to RPC, possibly one fallback)

// 3. Compare
IMPROVEMENT = (OLD_DURATION - NEW_DURATION) / OLD_DURATION * 100
REQUEST_REDUCTION = (OLD_QUERIES - NEW_QUERIES) / OLD_QUERIES * 100

console.log(`
  Requests: ${OLD_QUERIES} → ${NEW_QUERIES} (${REQUEST_REDUCTION}% reduction)
  Duration: ${OLD_DURATION}ms → ${NEW_DURATION}ms (${IMPROVEMENT}% faster)
  Confirmed 100% numeric parity: ${PARITY_TEST_PASS}
`)
```

---

## Query Plan Analysis (To Run After Implementation)

```sql
-- After RPC implementation, run:
EXPLAIN ANALYZE
SELECT * FROM get_customer_service_metrics_batch_v1(
  jsonb_build_array(
    jsonb_build_object(
      'customer_id', '550e8400-e29b-41d4-a716-446655440000',
      'customer_code', 'C001',
      'customer_phone', '+966512345678',
      'customer_name', 'محمد علي',
      'branch', 'الشامي'
    )
  )
);

-- Review output:
-- 1. Check if using indexes on customer_code, customer_id, customer_phone
-- 2. Verify scan type (SeqScan vs IndexScan)
-- 3. Look for missing index recommendations
-- 4. Analyze join strategy (should be minimal since single table)
```

---

## Index Strategy

### Current Indexes (From Migrations)

```sql
CREATE INDEX idx_sales_invoices_customer_code
  ON public.sales_invoices (customer_code);

CREATE INDEX idx_sales_invoices_invoice_date_branch
  ON public.sales_invoices (invoice_date, branch);

CREATE INDEX sales_invoices_customer_code_date_idx
  ON public.sales_invoices (customer_code, invoice_date);
```

### Recommended Additional Indexes (If Query Plan Shows Missing)

```sql
-- Phone-based queries (fallback strategies 3-4)
CREATE INDEX IF NOT EXISTS idx_sales_invoices_phone
  ON public.sales_invoices (customer_phone)
  WHERE customer_phone IS NOT NULL AND TRIM(customer_phone) <> '';

CREATE INDEX IF NOT EXISTS idx_sales_invoices_phone_trgm
  ON public.sales_invoices USING GIST (customer_phone COLLATE "C" GIST_TRGM_OPS)
  WHERE customer_phone IS NOT NULL;

-- Customer ID (strategy 2)
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_id
  ON public.sales_invoices (customer_id)
  WHERE customer_id IS NOT NULL;

-- Branch filtering (branch isolation)
CREATE INDEX IF NOT EXISTS idx_sales_invoices_branch
  ON public.sales_invoices (branch);
```

### Index Decision Rule
- ✅ Add only if EXPLAIN ANALYZE shows it's used in plan
- ❌ Don't add speculatively
- Verify performance gain before committing

---

## Frontend Integration Plan

### Current Usage (CustomerService.tsx line 1698)

```typescript
const enrichmentTargets = filteredTabRows.slice(0, limit);
const enrichmentResults = await useCustomerServiceMetricsEnrichment(enrichmentTargets);
// enrichmentResults: Map<key, CustomerServiceLiveMetrics>
```

### New RPC Integration

```typescript
// Option 1: Direct RPC call (minimal changes)
const rpcInput = enrichmentTargets.map(row => ({
  customer_id: row.customer_id,
  customer_code: row.customer_code,
  customer_phone: row.customer_phone,
  customer_name: row.customer_name,
  branch: row.branch
}));

const { data, error } = await supabase.rpc('get_customer_service_metrics_batch_v1', {
  p_customers: rpcInput as any  // JSONB array
});

if (error) {
  // Fallback to old path or show error
  return handleError(error);
}

// Convert data to Map<key, CustomerServiceLiveMetrics>
const enrichmentResults = new Map();
for (const row of data) {
  const key = customerMetricsKey({...});
  enrichmentResults.set(key, {
    total_spent: row.total_spent,
    invoices_count: row.invoices_count,
    // ... all 20 fields from RPC
  });
}
```

### Error Handling

```typescript
// NO automatic N+1 fallback on timeout/error
// Reasons:
// 1. Single timeout can trigger 300+ query storm
// 2. Better to show error UI than cause cascade failure

try {
  const { data, error } = await supabase
    .rpc('get_customer_service_metrics_batch_v1', {...})
    .timeout(3000);
  
  if (error) throw error;
  return processResults(data);
  
} catch (error) {
  // Return empty/null result
  // UI shows: "Unable to load metrics. Please try again."
  // No automatic fallback to N+1
  return null;
}
```

---

## Concurrency=15 Reevaluation

### Current State
Phase 1 set concurrency=15 in `batchEnrichCustomerServiceMetrics()`

### After Phase 2 RPC
If batch RPC reduces from 376-382 queries to 1-2:
- Concurrency parameter becomes irrelevant (no looping)
- Remove complexity if RPC handles all 250 customers in single call

### Recommendation
```typescript
// Phase 2: If batch RPC active, set to simpler:
const concurrency = 1;  // Single batch RPC call

// Or delete batching entirely:
export async function batchEnrichCustomerServiceMetrics(items) {
  // New implementation: single RPC call
  const results = await supabase.rpc('get_customer_service_metrics_batch_v1', {...});
  // No loop, no concurrency needed
}
```

---

## Testing Checklist (For Implementation)

- [ ] RPC accepts JSONB array input
- [ ] Matching priority preserved (code > uuid > phone > phone_tail > name)
- [ ] 100% numeric parity with 50+ customer test sample
- [ ] Branch isolation verified with multi-branch customer test
- [ ] Query plan analyzed (indexes efficient)
- [ ] Frontend integration tested on /customer-service
- [ ] No blank screens or loading loops
- [ ] Error handling shows graceful error UI (no fallback)
- [ ] Timeout after 3 seconds
- [ ] Performance benchmark: 1-2 queries vs 376-382
- [ ] Duration: <50ms target
- [ ] TypeScript: tsc --noEmit passes
- [ ] Tests: npm run test 51/51 pass
- [ ] Build: npm run build succeeds

---

## Files to Create/Modify

**New Files**:
- ✅ `supabase/migrations/20260818_customer_service_metrics_batch_rpc_v1.sql` (created, needs implementation)
- `scripts/measure-phase2-parity.cjs` (numeric parity test - TODO)
- `scripts/measure-phase2-batch.cjs` (performance benchmark - TODO)
- `PHASE2_IMPLEMENTATION.md` (this file)

**Modified Files**:
- `src/lib/customerServiceCustomerMetrics.ts` (integrate RPC, remove N+1 looping)
- `src/pages/CustomerService.tsx` (if needed - minimal changes)

---

## Next Steps

1. ✅ Freeze baseline (done)
2. ✅ Extract matching logic (done)
3. ✅ Design RPC (done)
4. ⏳ **Implement metrics aggregation in SQL** (this guide)
5. ⏳ Test numeric parity (50+ customers)
6. ⏳ Performance benchmark
7. ⏳ Frontend integration
8. ⏳ Production preview testing
9. ⏳ Final report

---

**Status**: SPECIFICATION COMPLETE - Ready for implementation  
**Next**: Follow SQL implementation steps above to complete RPC
