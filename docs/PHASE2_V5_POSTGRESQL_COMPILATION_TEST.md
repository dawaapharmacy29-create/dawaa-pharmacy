# PostgreSQL Real Compilation Test for RPC v5

## Test Objective

Verify that the complete v5 SQL migration (689+ lines) compiles without syntax, type, or function errors in PostgreSQL.

## Test Approach

Use PostgreSQL BEGIN/ROLLBACK transaction to test compilation without permanent changes:

```sql
BEGIN;

-- Insert the complete v5 migration SQL here
[... full v5 migration content ...]

-- Verify function signature
\df get_customer_service_metrics_batch_v5

-- Verify helper functions exist
\df get_amount_v5
\df get_date_v5
\df get_invoice_id_v5
\df get_branch_v5
\df last_digits_v5

-- Rollback all changes (no permanent impact)
ROLLBACK;

-- Verify functions do NOT exist after rollback
\df get_customer_service_metrics_batch_v5
\df get_amount_v5
```

## How to Execute This Test

### Via Supabase Dashboard (Recommended)

1. Navigate to: https://app.supabase.com/projects/jkjqeqkshllustwlzzbf/sql
2. Click "New query" button
3. Copy the entire v5 migration file:
   - File: `supabase/migrations/20260818_customer_service_metrics_batch_rpc_v5_parity_final.sql`
   - Wrap it with: `BEGIN;` at top, `ROLLBACK;` at bottom
4. Paste into SQL Editor
5. Click "Run" button (Ctrl+Enter)
6. Wait for compilation result (typically 3-5 seconds)

### Via psql Command Line (Alternative)

```bash
cd supabase/migrations
cat 20260818_customer_service_metrics_batch_rpc_v5_parity_final.sql | \
  psql "postgresql://postgres:[PASSWORD]@jkjqeqkshllustwlzzbf.supabase.co:5432/postgres" \
    --transaction-isolation-level serializable -c "BEGIN;" -f - -c "ROLLBACK;"
```

## Expected Compilation Results

### SUCCESS Indicators

✅ No error message appears  
✅ Query completes in 1-5 seconds  
✅ All 6 functions compile: 
- `get_amount_v5` (returns numeric)
- `get_date_v5` (returns date)  
- `get_invoice_id_v5` (returns text)
- `get_branch_v5` (returns text)
- `last_digits_v5` (returns text)
- `get_customer_service_metrics_batch_v5` (main RPC, returns table with 26 columns)

### FAILURE Indicators

❌ Syntax error appears (e.g., "parse error at...")  
❌ Type mismatch error (e.g., "cannot cast...")  
❌ Undefined function error (e.g., "function ... does not exist")  
❌ Timeout or incomplete query  

## Rollback Verification

After compilation test, verify that rollback worked:

```sql
-- This should show: "Did not find any relation named..."
\df get_customer_service_metrics_batch_v5

-- If functions DO still exist, the ROLLBACK failed!
```

## Critical Compilation Checks in v5

1. **Input Parsing (Lines 160-167)**
   - ✓ JSONB array parsing with ORDINALITY
   - ✓ NULL-safe type casting for UUID, text fields

2. **Strategy CTEs (Lines 169-400)**
   - ✓ EXISTS subqueries compile
   - ✓ All input_idx correlations are valid
   - ✓ No unreferenced CTEs

3. **Helper Functions (Lines 100-159)**
   - ✓ Recursive calls (none - all immutable)
   - ✓ Type signatures match usage
   - ✓ NULL handling correct

4. **Name + PhoneTail Filtering (Lines 244-348)**
   - ✓ Two-stage filtering logic compiles
   - ✓ cte_name_customer_name_filtered defined
   - ✓ cte_name_name_filtered defined
   - ✓ last_digits_v5() calls valid

5. **Dedup and Aggregation (Lines 390-450)**
   - ✓ DISTINCT ON with multi-column identity
   - ✓ All aggregate functions valid
   - ✓ GROUP BY clauses match output columns

6. **Security (Lines 680-684)**
   - ✓ GRANT/REVOKE statements valid
   - ✓ Role "authenticated" exists

## Documentation of Test Result

After running the test, document:

1. **PostgreSQL Version**: (displayed in Supabase dashboard)
2. **Compilation Time**: (seconds)
3. **Errors**: (count and types)
4. **Rollback Status**: (confirmed functions absent after rollback)
5. **Overall Result**: PASS / FAIL

## Parity Test Prerequisites

Only after SUCCESSFUL compilation test:
- Deploy v5 to Supabase (make compilation permanent)
- Run parity tests against live data
- Compare v5 output with v4/JS output

## File References

- v5 Migration: `supabase/migrations/20260818_customer_service_metrics_batch_rpc_v5_parity_final.sql`
- v4 Comparison: `supabase/migrations/20260818_customer_service_metrics_batch_rpc_v4_critical_fixes.sql`
- LIMIT 700 Analysis: `docs/PHASE2_LIMIT_700_ANALYSIS.md`
