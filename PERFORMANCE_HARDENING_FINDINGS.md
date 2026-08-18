# PERFORMANCE HARDENING - DETAILED FINDINGS

## CRITICAL ISSUE #1: N+1 Query Storm in customerServiceCustomerMetrics
**Severity:** P0 - CRITICAL  
**File:** src/lib/customerServiceCustomerMetrics.ts  
**Function:** `getCustomerServiceLiveMetrics()` + `fetchByStrategies()`  
**Impact:** **250 customer requests × 3-5 RPC calls each = 750-1250 queries**

### The Problem
```typescript
async function fetchByStrategies(input: CustomerMetricsLookup) {
  // Makes 5 strategy attempts:
  // 1. customer_code = value (eq)
  // 2. customer_id = value (eq)
  // 3. customer_phone = value (eq)
  // 4. customer_phone ILIKE %tail (ilike)
  // 5. customer_name ILIKE %name (ilike)
  
  // Each attempt queries sales_invoices independently!
  for (const strategy of strategies) {
    for (const column of strategy.columns) {
      const { rows } = await querySalesInvoices(column, strategy.op, strategy.value);
      // ... process
    }
  }
}
```

Then `batchEnrichCustomerServiceMetrics()` calls this with concurrency=5:
```typescript
for (let index = 0; index < entries.length; index += concurrency) {
  const chunk = entries.slice(index, index + concurrency);
  await Promise.all(
    chunk.map(([key, item]) => getCustomerServiceLiveMetrics(item)) // Each triggers 3-5 queries
  );
}
```

### Call Chain
1. CustomerService.tsx line 1754: `useCustomerServiceMetricsEnrichment(enrichmentTargets)`
2. customerServiceCustomerMetrics.ts line 350: `batchEnrichCustomerServiceMetrics(items)` 
3. For each item, calls `getCustomerServiceLiveMetrics()` with concurrency=5
4. Each call triggers `fetchByStrategies()` which makes 3-5 independent sales_invoices queries

### Why This Breaks
- **Concurrency:** 5 concurrent requests × 750-1250 total queries = **massive DB load**
- **Latency:** 750-1250 queries × avg 200ms = **2.5-4 minutes total** even if parallel
- **Customer page load:** Blocked waiting for all metrics to enrich
- **Each navigation:** Triggers full re-enrichment because `serialized` in useEffect re-runs

### Recommended Fix
1. Use aggregated RPC: `get_customer_metrics_batch(customer_codes[], customer_ids[], phones[])`
   - Single query instead of 750+
   - Database can optimize lookup with indexes
   - Return all metrics in one payload

2. Cache by lookup strategy, not by individual customer
   - Cache at RPC level, not in-memory map
   - Prevent re-queries on identical lookups

3. Reduce concurrency during enrichment if full batch is unavoidable

---

## CRITICAL ISSUE #2: Enrichment Pipeline Duplication
**Severity:** P0 - CRITICAL  
**Files:** CustomerService.tsx + customerServiceCommandCenter.ts  
**Functions:** `enrichFollowupRows()` + `liveMetricsByKey` hook  
**Impact:** **Same metrics fetched twice for same customer**

### The Problem
```typescript
// customerServiceCommandCenter.ts line 389-410
async function enrichFollowupRows(rows: FollowupRow[], filters: FollowupFilters) {
  // Fetch #1: getCustomers(limit=250) to enrich rows with customer_metrics
  const result = await getCustomers({...});
  const byKey = new Map<string, CustomerMetric>();
  result.customers.forEach((metric) => indexMetric(byKey, metric));
  // ...
  return rows.map((row) => ({...row, customer_metrics: metric}));
}

// CustomerService.tsx line 1754
const liveMetricsByKey = useCustomerServiceMetricsEnrichment(enrichmentTargets);
// Fetch #2: useCustomerServiceMetricsEnrichment → batchEnrichCustomerServiceMetrics
//           → getCustomerServiceLiveMetrics() → 3-5 sales_invoices queries

// Both results merged, but are they for the same customers?
```

### Why This Fails
- `enrichFollowupRows()` fetches from `customer_metrics_summary` (aggregate data)
- `liveMetricsByKey` fetches raw sales_invoices (detail data)
- **Different datasets**, **different latency**, **different row counts**
- If customer in follow-up doesn't match any in customer_metrics_summary → gap
- If live metrics enrichment is slow → UI shows incomplete data while waiting

### Recommended Fix
1. Use single enrichment source: `customer_metrics_summary` RPC only
2. If live/real-time data needed: Add `last_updated_at` column to customer_metrics_summary
3. Cache enriched followups at Supabase row level, not client-side

---

## CRITICAL ISSUE #3: Large SELECT with All Columns
**Severity:** P0 - CRITICAL  
**File:** CustomerService.tsx line 1830 (approx)  
**Query:** `select(id, date, followup_date, customer_code, ..., customer_metrics)` - **20+ columns**  
**Limit:** `.limit(10000)`  
**Impact:** 20+ columns × 10,000 rows = **payload bloat**

### The Problem
```typescript
let query = supabase
  .from('daily_followups')
  .select('id,date,followup_date,customer_code,...,customer_metrics')  // 20+ columns
  .gte('date', start)
  .lte('date', end)
  .order('date', { ascending: true })
  .limit(10000);
```

Not all columns are needed for the UI. Example:
- List view: needs id, date, status, customer_code, branch
- Detail view: needs all
- Export: needs subset
- But query loads ALL for ALL use cases

### Recommended Fix
1. Declare minimal columns for list view: `id,date,customer_code,branch,status,followup_status,customer_metrics`
2. Lazy-load full row when detail panel opens (second query)
3. Use column projection at Supabase level

---

## HIGH PRIORITY ISSUE #4: Batch Concurrency = 5
**Severity:** P1 - HIGH  
**File:** src/lib/customerServiceCustomerMetrics.ts line 340  
**Code:**
```typescript
const concurrency = 5;
for (let index = 0; index < entries.length; index += concurrency) {
  const chunk = entries.slice(index, index + concurrency);
  await Promise.all(chunk.map(...));
}
```

### Problem
- 250 items ÷ 5 concurrency = 50 batches (sequential)
- Each batch waits for previous to complete
- If each query = 200ms, then 50 × 200ms = 10 seconds just for batching

### Fix
1. Increase concurrency to 20-30 (if DB can handle)
2. Or use aggregated RPC (eliminates batching entirely)

---

## HIGH PRIORITY ISSUE #5: Full-Table Update Triggers on Every Invoice Change
**Severity:** P1 - HIGH  
**File:** supabase/migrations/20260726213000_refresh_all_followup_customer_metrics.sql  
**Trigger:** `sales_invoices_refresh_followup_metrics_insert` (and UPDATE, DELETE variants)  
**Function:** `refresh_daily_followup_customer_metrics(p_customer_code text)`  
**Impact:** **Every invoice change triggers database-side UPDATE on entire daily_followups table**

### The Problem
```sql
-- Trigger fires on INSERT/UPDATE/DELETE of sales_invoices
-- Calls: refresh_daily_followup_customer_metrics(customer_code)
-- Which does:
UPDATE daily_followups df
SET (...)
FROM matched_metrics mm
WHERE df.id = mm.followup_id
AND (df.last_purchase_date IS DISTINCT FROM mm.last_purchase ...);
```

**If 100 invoices imported:**
- 100 INSERT triggers
- Each calls `refresh_daily_followup_customer_metrics()`
- Each potentially updates hundreds of daily_followups rows
- **Result:** 100+ database UPDATE statements on same table

### Recommended Fix
1. **Batch the trigger:** Collect invoice_codes, run refresh once after batch import
2. **Add conditional:** Only refresh if metrics actually changed
3. **Defer refresh:** Schedule for off-peak time (1x per hour, not per-invoice)

---

## High Priority ISSUE #6: Dashboard Card Waterfall
**Severity:** P1 - HIGH  
**Files:** ExecutiveDashboard2027Resilient.tsx, DoctorDashboardEnhanced.tsx  
**Issue:** Each card makes independent RPC call  
**Example:** Dashboard render → 5+ RPCs (dashboard_stats, sales_summary, customer_metrics, etc.)

### Fix
Combine into single RPC: `get_executive_dashboard_snapshot()`

---

## SUMMARY TABLE: Issues by Severity & Impact

| Issue | Severity | Impact | Affected Pages | Estimated Slowdown |
|-------|----------|--------|---|---|
| N+1 Query Storm (Issue #1) | P0 | 750-1250 queries per page | Customer Requests | 2-4 sec |
| Enrichment Duplication (Issue #2) | P0 | Fetch same data twice | Customer Requests | 1-2 sec |
| Large SELECT (Issue #3) | P0 | Bandwidth bloat | Customer Service | 0.5-1 sec |
| Batch Concurrency (Issue #4) | P1 | Sequential instead of parallel | Customer Requests | 5-10 sec |
| Invoice Trigger (Issue #5) | P1 | Full-table updates | Customer Import | 30-60 sec |
| Dashboard Waterfall (Issue #6) | P1 | Sequential card loads | Dashboard | 2-3 sec |

---

## IMPLEMENTATION PLAN

### Phase 1: Quick Wins (30 mins)
- [ ] Increase batch concurrency from 5 → 20
- [ ] Reduce daily_followups SELECT to minimal columns

### Phase 2: N+1 Fix (1-2 hours)
- [ ] Create aggregated RPC: `get_customer_metrics_batch()`
- [ ] Refactor `fetchByStrategies()` to use single batch RPC
- [ ] Remove duplicate enrichment pipeline

### Phase 3: Trigger Hardening (1 hour)
- [ ] Add batch mode to invoice import
- [ ] Defer trigger refresh until import complete

### Phase 4: Dashboard Optimization (1 hour)
- [ ] Create `get_executive_dashboard_snapshot()` RPC
- [ ] Combine card queries

---

**Next:** Implement Phase 1 & 2 fixes with measurements
