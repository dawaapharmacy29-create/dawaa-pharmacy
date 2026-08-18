# Phase 2: N+1 Elimination via Batch RPC - Specification Document

**Status**: DESIGN PHASE - Before implementation  
**Date**: 2026-08-18  
**Branch**: perf/runtime-hardening-v2  
**Task**: Replace 376-382 queries with batch RPC (target: 1-5 database calls)

---

## ✅ Step 1: BASELINE FROZEN

**Phase 1 Final Metrics** (Ready for comparison):

| Metric | Value |
|--------|-------|
| Customers | 250 |
| Queries | 376-382 |
| Concurrency | 15 |
| Duration | 264ms |
| Typecheck | PASS |
| Tests | 51/51 PASS |
| Build | PASS |

All metrics saved for final comparison at end of Phase 2.

---

## ✅ Step 2: CURRENT MATCHING LOGIC EXTRACTED

**Source Files**:
- `src/lib/customerServiceCustomerMetrics.ts` (fetchByStrategies)
- `summarizeInvoices()` function
- `querySalesInvoices()` function

### Matching Priority & Strategy Table

| Priority | Strategy | Match Type | Branch Scoped | Input Columns | Query Columns | Can False Match? | Early Exit? |
|----------|----------|-----------|---------------|---------------|---------------|-----------------|-----------|
| 1 | Exact Code | Exact | NO | customer_code | customer_code, client_code, code | ❌ No | ✅ YES - if found |
| 2 | Exact UUID | Exact | NO | customer_id | customer_id, client_id | ❌ No (UUID validated) | ✅ YES - if found |
| 3 | Exact Phone | Exact | NO | customer_phone | customer_phone, phone, mobile, client_phone, whatsapp_phone | ❌ No (exact) | ✅ YES - if found |
| 4 | Phone Tail | Fuzzy | NO | customer_phone (last 10 digits) | phone columns with %{tail} | ⚠️ Possible | ✅ YES - if found |
| 5 | Name Fallback | Fuzzy | NO | customer_name | customer_name, name, client_name with %{name}% | ⚠️ High risk | ❌ NO |

### Matching Logic Details

**Step 1-3: Strong Matches (Code → UUID → Phone)**
- Exact equality operators (`eq`)
- Each strategy tried in priority order
- **EARLY EXIT**: Once any strong match found, stop strategies
- Purpose: Prevent name fallback from pulling unrelated records

**Step 4: Phone Tail Match**
- Last 10 digits of phone number
- Fuzzy match pattern: `%{tail}` (ilike)
- Used when full phone doesn't match but suffix might
- **EARLY EXIT**: If phone tail matched, stop (don't try name)

**Step 5: Name Fallback**
- Pattern: `%{name}%` (ilike match)
- Normalized Arabic name handling (alef variants, taa marbuta, etc.)
- **Phone co-filter**: If phone tail available, filter name results by phone
- No early exit - attempts all matching name-related columns
- **RISK**: Can pull unrelated customers with similar names

### Normalization Functions Used

```
cleanText(value)           → trim whitespace
digitsOnly(value)          → keep digits only
normalizeArabicName()      → standardize alef/taa/ya variants
lastPhoneDigits(phone, 10) → extract last 10 digits
isUuid(value)              → validate UUID format
```

### Column Search Order

**Code Columns**: `customer_code`, `client_code`, `code`  
**UUID Columns**: `customer_id`, `client_id`  
**Phone Columns**: `customer_phone`, `phone`, `mobile`, `client_phone`, `whatsapp_phone`  
**Name Columns**: `customer_name`, `name`, `client_name`

---

## ✅ Step 3: EXACT UI METRICS IDENTIFIED

**Metrics Used by Customer Service UI** (from `CustomerServiceLiveMetrics` type):

### Financial Metrics
- `total_spent` - Total amount spent by customer
- `invoices_count` - Total number of invoices
- `avg_invoice` - Average invoice amount
- `avg_monthly` - Average monthly spending
- `current_month_spent` - Current month total
- `previous_month_spent` - Previous month total
- `current_month_count` - Current month invoice count
- `previous_month_count` - Previous month invoice count

### Temporal Metrics
- `last_purchase` - Date of last invoice (ISO string)
- `first_purchase` - Date of first invoice (ISO string)
- `average_monthly_purchase_count` - Average invoices per month

### Branch Metrics
- `branch` - Most recent branch
- `branch_most_frequent` - Branch with most invoices
- `branch_highest_value` - Branch with highest spend
- `branch_last_purchase` - Branch of last invoice

### Status & Segmentation
- `segment` - Customer segment: VIP, Loyal, At Risk, Occasional
- `customer_status` - Status: نشط (active), يحتاج متابعة (needs follow-up), متوقف (inactive), لا يوجد شراء (no purchases)

### Metadata
- `matched_by` - How customer was matched (debug info)
- `invoices_matched_count` - Number of matching invoices
- `source` - Data source: 'sales_invoices' or 'fallback'

### UI Consumer Mapping

| Metric | Consumer Component | Purpose |
|--------|------------------|---------|
| `total_spent`, `invoices_count` | Customer row | Quick stats display |
| `segment`, `customer_status` | Customer row badge | Status indicator |
| `last_purchase` | Customer row | Last activity date |
| `avg_invoice`, `avg_monthly` | Summary panel | Spending pattern |
| `current_month_spent`, `previous_month_spent` | Monthly comparison | Trend analysis |
| `branch_most_frequent` | Filter/sort | Branch filtering |
| `matched_by` | Debug console | Match quality verification |

**Total Metrics Returned**: 20 fields per customer

---

## ✅ Step 4: INPUT/OUTPUT SPECIFICATION FOR RPC

### Input Parameters

**JSON/JSONB Array Input** (preferred):
```json
[
  {
    "customer_id": "550e8400-e29b-41d4-a716-446655440000",
    "customer_code": "C001",
    "customer_phone": "+966512345678",
    "customer_name": "محمد علي",
    "branch": "الشامي"
  },
  ...
]
```

### Output Specification

**One row per customer input** with these columns:

```sql
customer_id         UUID or NULL
customer_code       TEXT or NULL
customer_phone      TEXT or NULL
customer_name       TEXT or NULL
branch_input        TEXT (input branch, for matching/validation)

-- Financial metrics
total_spent         NUMERIC
invoices_count      INTEGER
avg_invoice         NUMERIC
avg_monthly         NUMERIC
current_month_spent NUMERIC
previous_month_spent NUMERIC
current_month_count INTEGER
previous_month_count INTEGER

-- Temporal metrics
last_purchase       DATE or NULL
first_purchase      DATE or NULL
average_monthly_purchase_count NUMERIC

-- Branch metrics
branch              TEXT or NULL (most recent)
branch_most_frequent TEXT or NULL
branch_highest_value TEXT or NULL
branch_last_purchase TEXT or NULL

-- Status & Segmentation
segment             TEXT or NULL (VIP, Loyal, At Risk, Occasional)
customer_status     TEXT or NULL (نشط, يحتاج متابعة, متوقف, لا يوجد شراء)

-- Metadata
matched_by          TEXT or NULL (matching strategy used)
invoices_matched_count INTEGER
source              TEXT ('sales_invoices' or 'fallback')

-- Matching confidence
match_confidence    TEXT or NULL (EXACT, FUZZY, FALLBACK, NONE)
```

---

## ✅ Step 5: RPC DESIGN SPECIFICATION

### Proposed RPC Name
```sql
get_customer_service_metrics_batch_v1
```

### Function Constraints

**Allowed**:
- SELECT queries
- Aggregation functions
- Window functions
- String normalization
- Date calculations
- NULL handling

**Forbidden**:
- UPDATE
- INSERT
- DELETE
- TRUNCATE
- DROP
- ALTER TABLE
- Refreshing/vacuuming tables
- Customer write-back operations

### Matching Priority Algorithm (In SQL)

**Pseudo-code**:
```
FOR EACH input customer:
  1. Try exact customer_code match
     IF found → RETURN these invoices + mark as "code"
  
  2. Try exact customer_id (UUID) match
     IF found → RETURN these invoices + mark as "uuid"
  
  3. Try exact phone match (all phone columns)
     IF found → RETURN these invoices + mark as "phone"
  
  4. Try phone tail (last 10 digits) fuzzy match
     IF found → RETURN these invoices + mark as "phone_tail"
  
  5. Try name fallback with phone co-filter
     IF phone_tail available:
       - Get name matches AND phone tail ends match
     ELSE:
       - Get name matches
     IF found → RETURN these invoices + mark as "name"
  
  6. If nothing found → RETURN NULL row + mark as "none"
```

### Expected Query Reduction

| Current | New | Reduction |
|---------|-----|-----------|
| 376-382 queries | 1-2 SQL calls | 99.5% reduction |
| 264ms | <50ms (estimated) | 80%+ faster |

---

## ✅ Step 6: BRANCH ISOLATION STRATEGY

### Branch Handling

**Current State**: `fetchByStrategies()` does NOT scope by branch.
- Input includes `branch` field but doesn't use it for filtering

**Phase 2 Requirement**: Implement explicit branch isolation

**Implementation Strategy**:
```sql
-- Match on identifiers first (code/UUID/phone independent of branch)
SELECT * FROM sales_invoices 
WHERE customer_code = p_code
  OR customer_id = p_uuid
  OR customer_phone = p_phone

-- BUT if multiple branches have same customer:
-- Add branch preference logic:
-- 1. Prefer matching branch (if p_branch provided)
-- 2. Fall back to most frequent branch
-- 3. Fall back to most recent branch
```

### Branch Isolation Test Case

**Test Scenario**:
- Customer "محمد علي" exists in both "الشامي" and "شكري" branches
- "الشامي" instance: 10 invoices
- "شكري" instance: 5 invoices
- Test with branch="الشامي"
- **Expected**: Return 10 invoices from "الشامي"
- **NOT**: All 15 mixed together

---

## ✅ Step 7: NUMERIC PARITY TEST PLAN

### Test Sample Selection

**Minimum 50 customers** with representation:

| Category | Count | Criteria |
|----------|-------|----------|
| High-volume | 5 | >50 invoices |
| Medium-volume | 10 | 5-50 invoices |
| Low-volume | 10 | 1-4 invoices |
| No invoices | 5 | 0 invoices |
| Code-matched | 8 | customer_code exists |
| UUID-matched | 8 | customer_id UUID exists |
| Phone-matched | 8 | phone number available |
| Name-matched | 5 | name fallback required |
| Multi-branch | 5 | customer in 2+ branches |
| Arabic variations | 3 | Name with alef/taa variants |
| Phone formatting | 5 | Non-standard phone formatting |

### Parity Comparison Matrix

For each of 50+ test customers:

```
| Customer | Metric | Old Value | New Value | Match | ✓/✗ |
|----------|--------|-----------|-----------|-------|-----|
| C001 | invoices_count | 42 | 42 | YES | ✓ |
| C001 | total_spent | 8500.50 | 8500.50 | YES | ✓ |
| C001 | avg_invoice | 202.39 | 202.39 | YES | ✓ |
| ... | ... | ... | ... | ... | ... |
```

**Passing Criteria**: 100% of metrics match for 100% of customers
**Failure Action**: STOP immediately, investigate mismatch

### Rounding Sensitivity

**No rounding tricks allowed**:
- No Math.max hiding results
- No silent fallbacks
- No epsilon comparisons
- Direct string comparison of date values
- Direct numeric comparison for amounts

---

## ✅ Step 8: PERFORMANCE BENCHMARK PLAN

### Benchmark Test Conditions

**Test Data**: Same 250 customers from Phase 1

**Metrics to Collect**:

```
OLD PATH (N+1 Sequential):
├─ Number of requests: 376-382
├─ Total duration: 264ms
├─ Max single query: ~30ms
├─ Data transferred: ~8-10MB
├─ Failed calls: 0
└─ Timeouts: 0

NEW PATH (Batch RPC):
├─ Number of requests: 1-2
├─ Total duration: <50ms
├─ Max single query: <40ms
├─ Data transferred: ~1-2MB
├─ Failed calls: 0
└─ Timeouts: 0
```

### Success Criteria

- ✅ Request count reduction: ≥95% (from 376-382 → ≤19)
- ✅ Target: 1-2 total requests
- ✅ Duration: <50ms preferred
- ✅ No timeout errors
- ✅ No failed requests
- ✅ Data transfer reasonable (<5MB)

---

## ✅ Step 9: FALLBACK STRATEGY (DEFENSIVE)

### Fallback Trigger Conditions

**Only enable fallback if ALL of these**:
- RPC endpoint unavailable
- Function definition missing
- Deployment mismatch detected
- Version mismatch detected

**Fallback Action**: Return empty/null result, display error UI
**NOT**: Automatic fallback to N+1 (prevents query storms)

### Timeout Handling

**Configuration**:
```typescript
timeout: 3000ms  // RPC call timeout
retries: 1       // Single retry on timeout
fallback_on_error: false  // Explicit: no automatic N+1
```

**User Experience on Timeout**:
```
UI: "Unable to load customer metrics. Please try again."
Retry button: Manual user action
Action: Do NOT trigger N+1 fallback
```

---

## ✅ Step 10: DATA LOADING OPTIMIZATION

### Current Load Analysis

**Question**: Why load metrics for 250 customers?

**Investigation Required**:
- Check CustomerService.tsx page rendering
- Check pagination in table display
- Check how many rows visible at once
- Check virtual scrolling implementation

### Batch Size Optimization

**Test scenarios**:
```
Visible rows:     25  → Load 25 customers
Viewport:         50  → Load 50 customers
Full table:       250 → Load 250 customers (if all loaded)
```

**Recommendation**: Only enrich visible/loaded customers
**If pagination available**: Load on-demand per page

---

## ✅ Step 11: DUAL ENRICHMENT CHECK

### Current Data Flow Analysis

**Question**: Is customer data already enriched before metrics request?

**Paths to investigate**:
1. Customer list RPC (if exists)
2. User filter application
3. Table row rendering
4. Modal quick view display

**Finding Required**: 
- Is data enriched once or twice?
- Is cache being used effectively?

**Phase 2 Action**: Remove duplicate if found

---

## ✅ Step 12: PERFORMANCE BENCHMARK SCRIPT

**Create**: `scripts/measure-phase2-batch.cjs`

**Script should**:
1. Execute OLD path (N+1) with 250 customers
2. Execute NEW path (batch RPC) with same customers
3. Compare side-by-side
4. Report:
   - Request count reduction %
   - Duration comparison
   - Data transfer comparison
   - Error rates

---

## ✅ Step 13: QUERY PLAN ANALYSIS

### Query Plan Investigation

Before adding any indexes, run:
```sql
EXPLAIN ANALYZE
SELECT * FROM sales_invoices 
WHERE customer_code = ?
  OR customer_id = ?
  OR customer_phone = ?
  OR phone LIKE ?;
```

### Index Review Checklist

| Column | Index Exists? | Used by Plan? | New Index Needed? |
|--------|---------------|---------------|------------------|
| customer_code | ? | ? | ? |
| customer_id | ? | ? | ? |
| customer_phone | ? | ? | ? |
| phone | ? | ? | ? |
| branch | ? | ? | ? |
| invoice_date | ? | ? | ? |

**Action**: Only add indexes with query plan evidence

---

## Next Steps

1. ✅ Document matching logic (THIS DOCUMENT)
2. 🔄 Extract exact database schema (sales_invoices columns)
3. 🔄 Create migration with RPC
4. 🔄 Implement numeric parity test
5. 🔄 Performance benchmark
6. 🔄 Branch isolation test
7. 🔄 Frontend integration
8. 🔄 Production preview test
9. 🔄 Final report

---

**Document Status**: READY FOR RPC IMPLEMENTATION  
**Next Document**: PHASE2_IMPLEMENTATION.md (after design approval)
