# Phase 2: Step 11 Analysis - Visible Data Optimization

**Finding**: Critical optimization opportunity identified

## Current Implementation

**File**: `src/pages/CustomerService.tsx`
- Line 81: `const PAGE_SIZE = 18`
- Line 1363: `const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)`
- Line 1689: `filteredTabRows.slice(0, visibleCount).map(...)` ← **Only loads visible customers**
- Line 2929: Click "Load more" increments by PAGE_SIZE

## Investigation Question Resolution

**Q**: "Why load metrics for 250 customers?"

**A**: Current code **does NOT load all 250**! It only loads 18 initially, then 18 more per "Load more" click.

**Implication for Benchmarking**:
- Benchmark used 250 customers with concurrency=15
- Actual page usage: 18-36 customers visible at once
- Real-world baseline may be much lower than 264ms (probably 25-40ms)
- Phase 2 RPC will still reduce N+1 calls but on smaller dataset

## Batch Size Analysis

### Scenario 1: Initial Page Load
- Visible rows: 18 (PAGE_SIZE)
- Current queries: 18 * 1.50 ≈ 27 queries (at 264ms / 250 = 1.06ms per customer)
- Estimated time: 27 * 1.06ms ≈ 28-30ms
- With concurrency=15: ≈ 2-3 batches

### Scenario 2: After 3 "Load More" Clicks
- Visible rows: 18 + 18 + 18 + 18 = 72 customers
- Current queries: 72 * 1.50 ≈ 108 queries
- Estimated time: ~114ms

### Scenario 3: If User Selects "Show All" or Filters Down to 150
- Visible rows: 150 customers
- Current queries: 150 * 1.50 ≈ 225 queries
- Estimated time: ~240ms

## Implications for Phase 2

### Load Optimization Opportunity

**Current**: Load metrics for slice(0, visibleCount)
- Pro: Only loads what's visible
- Con: Metrics load incrementally as user scrolls, causing re-renders

**Phase 2 Option A**: Keep same pagination (recommended)
- Load 18 customers per batch RPC
- RPC handles 18 → 1 query instead of 27 sequential
- Result: 28-30ms → ~5-8ms per page load
- Estimated improvement: 75-80%

**Phase 2 Option B**: Load all with RPC (more efficient)
- Load all visible + prefetch next batch
- RPC: 72 customers → 1 query
- Results cached, fast when user clicks "Load more"
- Potential improvement: 90%+

### Recommendation

**Option A** (safer):
- Maintain existing pagination logic
- Replace `batchEnrichCustomerServiceMetrics()` with batch RPC
- No changes to enrichmentTargets selection
- Lower risk, clearer improvement

**Option B** (ambitious):
- Modify to `slice(0, min(visibleCount + PAGE_SIZE, filteredTabRows.length))`
- Prefetch next batch
- Smooth scrolling without re-enrichment
- Higher complexity

## Test Batch Sizes for Parity

Since real-world usage is 18-72 customers, not 250:

**Parity test should include**:
- 18 customers (initial page load)
- 36 customers (after one "Load more")
- 50 customers (mixed scenario)
- 100+ customers (edge case)

**NOT** just 50-250 in old benchmark

## Revised Performance Target

### Old Baseline (Phase 1)
- 250 customers: 264ms
- Concurrency=15 improvement

### New Baseline (Realistic)
- 18 customers: ~28-30ms (estimated)
- 72 customers: ~114ms (estimated)

### Phase 2 Target
- 18 customers: ~5-8ms (batch RPC)
- 72 customers: ~8-12ms (batch RPC)
- Improvement: 75-90%

## Code Path Analysis

**Current enrichment flow**:
```
CustomerService.tsx line 1689:
  filteredTabRows.slice(0, visibleCount)
    ↓
  enrichmentTargets = [...] (18-72 items)
    ↓
  useCustomerServiceMetricsEnrichment(enrichmentTargets)
    ↓
  batchEnrichCustomerServiceMetrics() with concurrency=15
    ↓
  getCustomerServiceMetrics() per customer (1.5x N+1)
    ↓
  querySalesInvoices() × 27-108 times
```

**After Phase 2 RPC**:
```
CustomerService.tsx line 1689:
  filteredTabRows.slice(0, visibleCount)
    ↓
  enrichmentTargets = [...] (18-72 items)
    ↓
  useCustomerServiceMetricsEnrichment(enrichmentTargets)
    ↓
  supabase.rpc('get_customer_service_metrics_batch_v1', {p_customers})
    ↓
  Single SQL query with all 18-72 customers
```

## Dual Enrichment Check (Step 12)

**Question**: Is customer data already enriched before metrics request?

**Investigation**:
- FollowupRow type has existing fields from customer_requests table
- These are populated from `rows` which come from `get_customer_service_operations_v2()` RPC
- RPC may already include some metrics (need to check)

**Current enrichment logic** (Line 1712-1745):
```typescript
const enrichRow = (row: FollowupRow): FollowupRow => {
  const live = liveMetricsByKey.get(key);
  if (!live) return row;  // ← No enrichment if not found
  
  // Apply live metrics but DON'T overwrite existing data if live is 0
  const fallbackTotal = totalSpent(row);  // ← Use row's existing field
  const nextTotal = live.total_spent > 0 ? live.total_spent : fallbackTotal;
}
```

**Finding**: Code implements **fallback strategy**, not duplicate enrichment
- Primary source: `get_customer_service_operations_v2()` RPC
- Fallback: Live metrics from sales_invoices if primary is empty
- NOT duplicate enrichment (good!)

**Conclusion**: Dual enrichment NOT an issue in current code

## Recommendation for Phase 2

### Immediate
1. Use actual visible count (18-72) not 250 in tests
2. Benchmark realistic page load: 18-36 customers
3. Keep pagination logic unchanged
4. Option A is recommended for simplicity

### Phase 2 Full RPC Implementation
```typescript
// Current (Phase 1):
const enrichmentTargets = useMemo(
  () => filteredTabRows.slice(0, visibleCount).map(...),
  [filteredTabRows, visibleCount]
);
const liveMetricsByKey = useCustomerServiceMetricsEnrichment(enrichmentTargets);

// Phase 2 (no change to page logic, only hook internals):
// useCustomerServiceMetricsEnrichment() will call batch RPC instead
```

### Performance Expectation
- Current: 28-30ms for initial 18 customers
- After Phase 2: 5-8ms for initial 18 customers
- User-perceived improvement: 70-80%

### Testing Priority
1. ✅ Verify PAGE_SIZE = 18 (done)
2. Test with 18 customers (initial load)
3. Test with 36 customers (one "Load more")
4. Test with 72 customers (realistic usage)
5. Edge case: 250 customers (if user filters down)

## Action Items

- [ ] Update parity test to use 18/36/72 instead of just 50
- [ ] Measure baseline for 18-customer load (actual real-world scenario)
- [ ] Confirm batch RPC improves 18-customer case
- [ ] Verify no regression when user loads 250+ customers
- [ ] Document real-world improvement expectation

---

**Status**: Investigation complete, findings documented
**Next**: Create revised parity test with realistic batch sizes
