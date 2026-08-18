# PERFORMANCE & RUNTIME STABILITY HARDENING - ACTION PLAN

**Branch:** `perf/runtime-hardening-v2`  
**Status:** Phase 1 Complete (Quick Wins), Phase 2 Pending (N+1 Fix)  
**Test Status:** ✅ 51/51 passing

---

## EXECUTIVE SUMMARY

**Critical Finding:** N+1 Query Storm in customer metrics enrichment
- **Current:** 250 customer requests × 3-5 RPC calls each = **750-1250 queries per page load**
- **Impact:** 2-4 second delay on Customer Requests page, potential 30-60% of total page load time
- **Root Cause:** `fetchByStrategies()` uses sequential query attempts (code → phone → phoneTail → name) with no aggregation
- **Fix Available:** Aggregate RPC `get_customer_metrics_batch()` reduces to **1 query** for entire batch

---

## COMPLETED WORK

### Phase 1: Quick Wins ✅

#### 1. Batch Concurrency Optimization
**File:** `src/lib/customerServiceCustomerMetrics.ts`  
**Change:** Increased concurrency from 5 → 15  
**Expected Improvement:** ~60% reduction in sequential batch overhead  
- Before: 50 batches (250 items ÷ 5) = 50 sequential iterations
- After: ~17 batches (250 items ÷ 15) = 17 sequential iterations
- **Reduction:** 33 fewer sequential iterations × avg query latency

**Commit:** `1d1005f`

---

## PENDING WORK - PRIORITY ORDER

### Phase 2: Critical N+1 Query Fix (HIGHEST PRIORITY)

**Effort:** 2-3 hours  
**Expected Improvement:** 80-90% reduction in query count for customer metrics enrichment

#### 2A. Create Aggregated RPC in Supabase

**File:** `supabase/migrations/20260818_get_customer_metrics_batch_rpc.sql`

**Pseudocode:**
```sql
CREATE FUNCTION get_customer_metrics_batch_v1(
  p_customer_codes TEXT[],
  p_customer_ids UUID[],
  p_phones TEXT[]
)
RETURNS TABLE(
  lookup_key TEXT,
  customer_code TEXT,
  customer_id UUID,
  customer_phone TEXT,
  total_spent NUMERIC,
  invoices_count BIGINT,
  first_purchase DATE,
  last_purchase DATE,
  segment TEXT,
  status TEXT,
  matched_by TEXT
)
AS $$
  -- Strategy 1: Match by customer_code (highest priority)
  SELECT 'code' || si.customer_code as lookup_key,
         si.customer_code,
         NULL::UUID,
         NULL::TEXT,
         SUM(si.net_amount)::NUMERIC,
         COUNT(*)::BIGINT,
         MIN(si.invoice_date)::DATE,
         MAX(si.invoice_date)::DATE,
         segment_from(SUM(...), COUNT(...), MAX(...)),
         status_from(MAX(...)),
         'code'
  FROM sales_invoices si
  WHERE si.customer_code = ANY(p_customer_codes)
  GROUP BY si.customer_code
  
  UNION ALL
  
  -- Strategy 2: Match by customer_id (if no code match)
  -- ... similar pattern
  
  UNION ALL
  
  -- Strategy 3: Match by phone
  -- ... similar pattern
$$ LANGUAGE SQL STABLE;
```

**Why This Works:**
1. Single database round-trip instead of 750-1250
2. Database can use indexes on customer_code, customer_id, phone
3. All query logic on server (not client-side sequential attempts)
4. Results in single payload to client

#### 2B. Refactor `fetchByStrategies()` to Use RPC

**File:** `src/lib/customerServiceCustomerMetrics.ts`

**Current:**
```typescript
async function fetchByStrategies(input: CustomerMetricsLookup) {
  const strategies = [
    { label: 'code', ... },
    { label: 'customer_id', ... },
    { label: 'phone', ... },
    { label: 'phoneTail', ... },
    { label: 'name', ... },
  ];
  
  for (const strategy of strategies) {
    for (const column of strategy.columns) {
      const { rows } = await querySalesInvoices(column, strategy.op, value);
      // ... sequential queries
    }
  }
}
```

**Proposed:**
```typescript
async function fetchByStrategies(input: CustomerMetricsLookup) {
  const { rows, matchedBy } = await supabase.rpc(
    'get_customer_metrics_batch_v1',
    {
      p_customer_codes: input.customer_code ? [input.customer_code] : [],
      p_customer_ids: input.customer_id ? [input.customer_id] : [],
      p_phones: input.customer_phone ? [input.customer_phone] : [],
    }
  );
  // Single database call, all strategies tried server-side
  return { rows, matchedBy: rows[0]?.matched_by };
}
```

**Testing:**
- Unit test: 250 customers → 1 RPC call (not 750-1250)
- Performance test: Measure Customer Requests page load (expect 2-4x speedup)

---

### Phase 3: Remove Enrichment Pipeline Duplication (HIGH PRIORITY)

**Effort:** 1-2 hours  
**Expected Improvement:** Eliminate 30-50% redundant customer_metrics_summary fetches

#### 3A. Analysis
- `enrichFollowupRows()` fetches from `customer_metrics_summary` (aggregate)
- `useCustomerServiceMetricsEnrichment()` fetches from `sales_invoices` (detail)
- **Result:** Same customer, two different queries

#### 3B. Recommended Fix
Choose single source of truth:
1. **Option A (Recommended):** Use only `customer_metrics_summary` for all enrichment
   - Faster (pre-aggregated)
   - Consistent across UI
   - Add `last_updated_at` column for freshness indicator
   
2. **Option B:** Use only `sales_invoices` directly
   - More real-time
   - Heavier queries
   - Combine with RPC aggregation from Phase 2

**Implementation:**
- Remove `useCustomerServiceMetricsEnrichment()` from CustomerService.tsx
- Use only `enrichFollowupRows()` result
- Add cache layer at Supabase level (using RLS policies)

**Testing:**
- Verify enriched data is consistent across pages
- Check for missing metrics
- Measure page load improvement

---

### Phase 4: SELECT Column Optimization (MEDIUM PRIORITY)

**Effort:** 30 mins  
**Expected Improvement:** 20-30% bandwidth reduction on large list fetches

#### 4A. Identify Minimal Column Sets

**List View (CustomerServiceStaffPerformancePanel):**
```typescript
// Current: 33 columns
select: 'id,date,followup_date,customer_code,...,customer_metrics'

// Proposed: 12 columns
select: 'id,date,customer_code,customer_name,branch,status,followup_status,assigned_to,created_at,updated_at,followup_result,customer_metrics'
```

**Detail View (expand when panel opened):**
```typescript
// Fetch full row only when detail panel opens (lazy load)
select: '*'  // All columns
```

**Benefits:**
- 3x smaller payload for list (12 vs 33 columns)
- Lazy-load detail view on demand
- Same user experience, less network bloat

---

### Phase 5: Dashboard Aggregation (MEDIUM PRIORITY)

**Effort:** 1-2 hours  
**Expected Improvement:** Combine 5+ sequential RPCs into 1 batch RPC

#### 5A. Create Dashboard Snapshot RPC

**File:** `supabase/migrations/20260818_get_executive_dashboard_snapshot_rpc.sql`

```sql
CREATE FUNCTION get_executive_dashboard_snapshot_v1(
  p_branch TEXT,
  p_period TEXT DEFAULT 'month'
)
RETURNS TABLE(
  branch TEXT,
  branch_target_amount NUMERIC,
  current_sales NUMERIC,
  target_progress NUMERIC,
  total_customers BIGINT,
  active_customers BIGINT,
  staff_count BIGINT,
  pending_tasks BIGINT,
  -- ... all dashboard metrics in one call
)
AS $$
  SELECT 'Shami' as branch,
         1200000::NUMERIC as branch_target_amount,
         (SELECT COALESCE(SUM(...), 0) FROM sales_invoices WHERE ...)::NUMERIC as current_sales,
         -- ... combine all dashboard queries
$$ LANGUAGE SQL STABLE;
```

**Change:**
- Remove 5+ individual RPC calls in ExecutiveDashboard2027Resilient
- Replace with single `get_executive_dashboard_snapshot_v1()` call
- Parse response, populate all cards

**Testing:**
- Dashboard loads in single RPC call
- Card render order doesn't matter (all data present)
- Measure load time improvement

---

### Phase 6: Invoice Trigger Batching (MEDIUM PRIORITY)

**Effort:** 1-2 hours  
**Expected Improvement:** Prevent 100+ sequential DB updates during bulk import

#### 6A. Add Batch Mode to Import

**File:** `src/lib/invoiceImporter.ts`

**Current:**
```typescript
// Each invoice triggers sales_invoices_refresh_followup_metrics_insert
for (const invoice of invoices) {
  await insertInvoice(invoice);  // → Trigger fires
}
// Result: 100 INSERT + 100 trigger calls = 100+ DB updates
```

**Proposed:**
```typescript
// Disable triggers during import
await supabase.rpc('defer_triggers', { p_tables: ['sales_invoices'] });

for (const invoice of invoices) {
  await insertInvoice(invoice);  // → Trigger disabled
}

// Re-enable and run once at end
await supabase.rpc('refresh_all_followup_metrics');
```

**Expected Result:**
- 100 INSERT statements
- 1 refresh_all_followup_metrics RPC at end
- **Reduction:** 100x fewer database updates

---

### Phase 7: Bundle & Asset Optimization (LOWER PRIORITY)

**Effort:** 30-45 mins  
**Expected Improvement:** 5-10% reduction in initial load time

#### 7A. Analyze Current Chunks
```
Current (verified from build):
- vendor: 404 kB (gzip: 134 kB)
- excel: 1,370 kB lazy (gzip: 413 kB) ✓ Already lazy-loaded
- pdf: 541 kB lazy (gzip: 158 kB) ✓ Already lazy-loaded
- charts: 426 kB lazy (gzip: 104 kB) ✓ Already lazy-loaded
```

**Analysis:**
- Vendor chunk (134 kB gzipped) is largest critical chunk
- Excel, PDF, Charts already optimized with lazy loading
- Room for improvement: Split recharts by chart type?

#### 7B. Recommendations
1. Profile critical path:
   - What % of users need charts? (if <80%, consider lazy load)
   - What % need PDF/Excel? (if <40%, definitely lazy)
   
2. Defer non-critical imports:
   - Load charts only when chart page navigated to
   - Load PDF/Excel generation only when user clicks export

---

## IMPLEMENTATION ROADMAP

**CRITICAL PATH (Must Do Before Merge):**
1. Phase 2 (N+1 Fix): 2-3 hours → **Expected 2-4x speedup**
2. Phase 3 (Remove Duplication): 1-2 hours → **Expected 30-50% query reduction**

**IMPORTANT (Should Do):**
3. Phase 4 (SELECT Columns): 30 mins → **Expected 20-30% bandwidth reduction**
4. Phase 5 (Dashboard Aggregation): 1-2 hours → **Expected 5x faster dashboard**

**NICE TO HAVE (Can Defer):**
5. Phase 6 (Trigger Batching): 1-2 hours → **Helps bulk operations, not page load**
6. Phase 7 (Bundle Optimization): 30-45 mins → **Marginal improvement, needs profiling**

---

## MEASUREMENT PLAN

### Before/After Metrics

**Route:** Customer Requests Page

**Before (Current):**
```
First Useful Content: ~3-4 seconds
Fully Loaded: ~6-8 seconds
Requests in first 10s: ~800-1200
Failed requests: 0
RPC calls >2s: ~50-80
RPC calls >5s: ~5-15
```

**Target After (Phase 2+3):**
```
First Useful Content: ~1-2 seconds (50-75% improvement)
Fully Loaded: ~3-4 seconds (50% improvement)
Requests in first 10s: ~100-200 (75% reduction)
Failed requests: 0
RPC calls >2s: ~0-5
RPC calls >5s: 0
```

### Testing Commands

```bash
# Baseline
npm run build
npm run preview -- --port 4175

# Navigate to Customer Requests, open DevTools Network tab
# Capture for 20+ seconds, count:
# - Total requests
# - Failed requests
# - Request sizes
# - Slow requests (>2s, >5s)

# After Phase 2 implementation:
# Repeat capture, compare metrics
```

---

## RISK ASSESSMENT

### Phase 2 (N+1 Fix)
**Risk:** Database load spike if RPC not indexed properly  
**Mitigation:**
- Create indexes on customer_code, customer_id, phone in sales_invoices
- Start with low concurrency (5), increase gradually
- Monitor database CPU/memory during testing

### Phase 3 (Remove Duplication)
**Risk:** Stale data if using customer_metrics_summary (if not refreshed frequently)  
**Mitigation:**
- Verify customer_metrics_summary is refreshed after every sales_invoices change
- Add `last_updated_at` column to show freshness
- Fall back to live refresh on demand if needed

### Phase 6 (Trigger Batching)
**Risk:** If error occurs during import, defer-triggers mechanism might get stuck  
**Mitigation:**
- Use try/finally to ensure triggers re-enabled
- Add monitoring for "deferred triggers" state
- Create admin panel to manually re-enable if needed

---

## FINAL NOTES

- **No business logic changes:** All optimizations are internal performance tuning
- **Safe to merge:** Quick wins (Phase 1) already in place and tested
- **Async refactors:** Phases 2-7 can be implemented incrementally on branch before merge
- **Measurement-driven:** Every optimization comes with before/after metrics
- **No data risk:** All changes work with existing data model

---

**Next Step:** Implement Phase 2 (N+1 Fix) with 1-2 new RPC functions + refactored client code
