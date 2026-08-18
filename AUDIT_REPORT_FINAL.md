# RECONCILIATION AUDIT REPORT
**stability/runtime-closure-v1 vs origin/main (81244a0)**

---

## EXECUTIVE SUMMARY

**Branch Status:**
- Latest origin/main: `81244a0` (68 commits ahead of stability branch)
- stability/runtime-closure-v1: `ce49cb6` (3 commits, all required)
- Working tree: CLEAN (no uncommitted changes)

**Finding:** Main branch has **CRITICAL REGRESSIONS** that stability fixes.

**Recommendation:** CHERRY-PICK all 3 commits into new integration branch from main.

---

## CRITICAL FINDINGS: MAIN HAS 6 MAJOR REGRESSIONS

### 1. ❌ DUPLICATE /staff-payroll ROUTES (App.tsx)
**Severity: HIGH - Runtime conflict**

Main has TWO route definitions for same path:
```
Line 1: { path: '/staff-payroll', icon: WalletCards, label: 'Ïº┘äÏ▒┘êÏºÏ¬Ï¿', permission: 'manage_payroll' }
Line 2: { path: '/staff-payroll', icon: Wallet, label: 'Ïº┘äÏ▒┘êÏºÏ¬Ï¿', permission: 'view_salary_calculator' }
```

**Stability fix:** Removed duplicate, kept centralized APP_ROUTE_DEFINITIONS
**Commit:** 1850e76

---

### 2. ❌ NO PAGE SAFETY BOUNDARIES (App.tsx + PageSafetyBoundary.tsx)
**Severity: HIGH - App-wide crash risk**

- PageSafetyBoundary component EXISTS in main
- BUT NOT WRAPPED around lazy routes
- Lazy routes use `routeSuspense()` WITHOUT `PageSafetyBoundary` protection
- Page error crashes entire app (no isolation)

**Stability fix:** Integrated PageSafetyBoundary + Suspense wrapping
**Commit:** 1850e76

---

### 3. ❌ BROAD QUERY INVALIDATION (Invoices.tsx)
**Severity: HIGH - Performance regression**

**Main:** `queryKey: ['supabase']` (invalidates ALL queries)
**Stability:** `QUERY_KEYS.invoices.list()` (scoped to specific queries)

When one invoice is updated, main invalidates:
- All customer queries
- All sales queries  
- All followups
- All metadata

Creates unnecessary refetches and network storms.

**Commit:** 8605cd9

---

### 4. ❌ NO RUNTIME DEDUPLICATION (Hooks)
**Severity: MEDIUM - Memory/network overhead**

**Files affected:**
- `useNotifications.ts` - NO `__dawaaNotificationRuntime` dedup
- `usePendingShiftNotesCount.ts` - NO dedup
- Multiple subscribers trigger duplicate DB polls simultaneously

**Stability fix:** Runtime pooling + shared Promise deduplication
**Commits:** 8605cd9

---

### 5. ❌ STATIC IMPORTS FOR HEAVY LIBRARIES
**Severity: MEDIUM - Bundle bloat**

Main loads these at app startup:
- `xlsx` (library for Excel export)
- `html2canvas` (screenshot library)
- `jsPDF` (PDF generation)

Users never need these on initial load.

**Stability fix:** Dynamic imports (only load when needed)
**Files:** ReportsCenter.tsx, CustomerCoding.tsx, StaffMonthlyEvaluation.tsx, productsCatalog.ts
**Commit:** 8605cd9

---

### 6. ❌ BUILD SCRIPTS MUTATE SOURCE FILES (CRITICAL)
**Severity: CRITICAL - Build integrity violation**

**Main's behavior:**
- `enforce-invoice-branch-guard.cjs` calls `apply-shamy-apr-jul-cashback-exception.cjs`
- Both scripts use `fs.writeFileSync()` to modify source files DURING BUILD
- Changes are written to:
  - `CustomerCashback.tsx`
  - `customerEngagement.ts`
  - `CustomerPointsLedger.tsx`

**Problems:**
- Source files modified after git commit
- Build artifacts depend on file mutations
- Impossible to audit actual source
- Breaks reproducible builds

**Stability fix:** Both scripts converted to VALIDATION-ONLY (read-only checks)
**Commit:** ce49cb6

---

## FILE RECONCILIATION MATRIX

| File | Main Status | Stability Status | Conflict Risk | Action |
|------|---|---|---|---|
| **App.tsx** | BROKEN (duplicate /staff-payroll) | FIXED | HIGH | ✓ APPLY |
| **PageSafetyBoundary.tsx** | NOT INTEGRATED | WRAPPED all routes | LOW | ✓ APPLY |
| **appRoutes.test.ts** | NOT PRESENT | CREATED | NONE | ✓ APPLY |
| **enforce-invoice-branch-guard.cjs** | MUTATES SOURCE | VALIDATION-ONLY | MEDIUM | ✓ APPLY |
| **apply-shamy-apr-jul-cashback-exception.cjs** | MUTATES SOURCE | VALIDATION-ONLY | MEDIUM | ✓ APPLY |
| **useNotifications.ts** | NO DEDUP | RUNTIME POOL | LOW | ✓ APPLY |
| **usePendingShiftNotesCount.ts** | NO DEDUP | RUNTIME POOL | LOW | ✓ APPLY |
| **useQueryStaff.ts** | NO CENTRALIZED KEYS | QUERY_KEYS FACTORY | LOW | ✓ APPLY |
| **useSupabaseQuery.ts** | BROAD REFETCH | SCOPED REFETCH | LOW | ✓ APPLY |
| **useNetworkStatus.ts** | NOT PRESENT | CREATED | NONE | ✓ APPLY |
| **queryKeys.ts** | NOT PRESENT | CREATED | NONE | ✓ APPLY |
| **Sidebar.tsx** | 2x /staff-payroll | FIXED | LOW | ✓ APPLY |
| **Invoices.tsx** | ['supabase'] BROAD | QUERY_KEYS SCOPED | LOW | ✓ APPLY |
| **ReportsCenter.tsx** | Static xlsx | Dynamic import | NONE | ✓ APPLY |
| **CustomerCoding.tsx** | Static xlsx | Dynamic import | NONE | ✓ APPLY |
| **CustomerPointsLedger.tsx** | Static imports | Dynamic import | NONE | ✓ APPLY |
| **StaffMonthlyEvaluation.tsx** | Static PDF imports | Dynamic import | NONE | ✓ APPLY |
| **productsCatalog.ts** | Static xlsx | Dynamic import | NONE | ✓ APPLY |

---

## COMMIT DECISIONS

### Commit 1850e76 | "fix: stabilize routes, page isolation, and build integrity"
```
Decision: ✓ CHERRY-PICK (REQUIRED)
Files: 3 (App.tsx, PageSafetyBoundary.tsx, appRoutes.test.ts)
Risk: LOW - Main lacks all these fixes
Action: Apply first
```

**What it fixes:**
- Removes duplicate /staff-payroll routes
- Wraps all lazy routes with PageSafetyBoundary + Suspense
- Creates regression test preventing duplicate routes
- Centralizes route definitions

---

### Commit 8605cd9 | "perf: preserve runtime resilience and query cleanup"
```
Decision: ✓ CHERRY-PICK (REQUIRED)
Files: 14 (hooks, pages, queryKeys.ts, useNetworkStatus.ts)
Risk: LOW - New files + isolated hook changes
Action: Apply second
```

**What it fixes:**
- Adds runtime pooling to notifications/shift-notes (eliminates duplicates)
- Creates centralized queryKeys.ts factory
- Adds useNetworkStatus.ts (network detection)
- Converts 5 pages to dynamic imports (xlsx, html2canvas, jsPDF)
- Scopes query invalidation from ['supabase'] to QUERY_KEYS.invoices.* etc
- Adds network-aware retry logic for queries

---

### Commit ce49cb6 | "build: make cashback guard validation-only"
```
Decision: ✓ CHERRY-PICK (REQUIRED)
Files: 2 (enforce-invoice-branch-guard.cjs, apply-shamy-apr-jul-cashback-exception.cjs)
Risk: MEDIUM - Main's scripts still mutate (must override)
Action: Apply third
```

**What it fixes:**
- Removes ALL fs.writeFileSync calls from build scripts
- Converts both to read-only validation
- Eliminates source file mutations
- Makes builds reproducible

---

## VERIFIED TEST RESULTS (stability/runtime-closure-v1)

```
51 tests PASSED, 0 FAILED

✓ TypeScript: 0 errors
✓ Production build: 2999 modules, success
✓ Prebuild validation: CLEAN (no source mutations)
✓ Route registry: No duplicates
✓ All route paths accessible on localhost:4173
```

---

## BUILD INTEGRITY AUDIT

### Main Branch Scripts (PROBLEMATIC)
```bash
# enforce-invoice-branch-guard.cjs
require('./apply-shamy-apr-jul-cashback-exception.cjs')  ← CALLS OTHER MUTATING SCRIPT
fs.writeFileSync(..., content)                            ← MUTATES CustomerCashback.tsx

# apply-shamy-apr-jul-cashback-exception.cjs  
fs.writeFileSync(..., content)                            ← MUTATES 3 source files
patchFile(...)                                             ← MODIFIES CONTENT
```

### Stability Branch Scripts (FIXED)
```bash
# Both scripts now VALIDATION-ONLY
const fileContent = fs.readFileSync(path)                ← READ ONLY
if (!fileContent.includes(...)) throw error              ← CHECK ONLY
console.log('[build-validation] ... source. No files modified.')  ← REPORT ONLY
```

---

## SAFE INTEGRATION PLAN (DO NOT EXECUTE YET)

### Step 1: Create integration branch
```bash
git checkout -b integrate/stability-to-main-81244a0 origin/main
```
**Risk: NONE** - Creates new isolated branch

### Step 2: Apply route stabilization
```bash
git cherry-pick 1850e76
# Verify: No /staff-payroll duplicates, PageSafetyBoundary present
```

### Step 3: Apply runtime resilience
```bash
git cherry-pick 8605cd9
# Verify: queryKeys.ts, useNetworkStatus.ts created
# Verify: Dynamic imports for xlsx/html2canvas/jsPDF
# Verify: Dedup pooling in notification hooks
```

### Step 4: Apply build validation
```bash
git cherry-pick ce49cb6
# Verify: NO fs.writeFileSync in either script
# Run: npm run prebuild
# Run: git diff --exit-code (must be CLEAN)
```

### Step 5: Full verification
```bash
npm run prebuild          # No mutations allowed
git diff --exit-code      # Must be CLEAN
npm run typecheck         # Must pass (0 errors)
npm run test              # Must pass (51/51)
npm run build             # Must succeed
```

### Step 6: Decision gate
```
Do NOT merge to main until:
  ✓ All 3 commits applied successfully
  ✓ No source mutations during prebuild
  ✓ All 51 tests passing
  ✓ TypeScript compilation clean
  ✓ Production build succeeds
  ✓ User reviews and approves this report
```

---

## CRITICAL FILES THAT MUST NOT BE OVERWRITTEN

### Preserve from Latest Main:
- `src/pages/Dashboard.tsx` (main may have updates)
- `src/pages/ExecutiveDashboardRoute.tsx` (new features)
- `package.json` (new dependencies)
- Any NEW routes added after stability branch created

### Preserve from Stability Branch:
- `src/App.tsx` (route dedup + safety wrapping) **CRITICAL**
- `src/components/system/PageSafetyBoundary.tsx` (page isolation) **CRITICAL**
- `src/lib/__tests__/appRoutes.test.ts` (regression test) **CRITICAL**
- `src/hooks/useNotifications.ts` (dedup pooling) **CRITICAL**
- `src/hooks/usePendingShiftNotesCount.ts` (dedup pooling) **CRITICAL**
- `src/hooks/useNetworkStatus.ts` (network detection) **NEW**
- `src/lib/queryKeys.ts` (query key factory) **NEW**
- `scripts/enforce-invoice-branch-guard.cjs` (validation-only) **CRITICAL**
- `scripts/apply-shamy-apr-jul-cashback-exception.cjs` (validation-only) **CRITICAL**
- All dynamic import conversions (xlsx, html2canvas, jsPDF)

---

## CONFLICT RESOLUTION STRATEGY

### If App.tsx conflicts:
Strategy: Keep ALL of stability's route fixes + safety wrapping
          Merge in main's new routes AFTER the wrapping logic

### If useNotifications.ts conflicts:
Strategy: Ensure runtime pooling is preserved
          Main's new features can go AFTER dedup logic

### If query invalidation conflicts:
Strategy: Enforce QUERY_KEYS scoped invalidation
          REJECT any ['supabase'] broad key invalidation

### If build scripts conflict:
Strategy: Ensure validation-only (no fs.writeFileSync)
          Extract main's additional logic as separate checks if needed

---

## FINAL DECISION SUMMARY

| Item | Finding | Decision |
|------|---------|----------|
| **All 3 commits necessary?** | YES - Main has regressions | CHERRY-PICK ALL |
| **Source mutation risk?** | CRITICAL in main | APPLY ce49cb6 (fixes it) |
| **Route safety risk?** | HIGH in main | APPLY 1850e76 (fixes it) |
| **Query performance risk?** | HIGH in main | APPLY 8605cd9 (fixes it) |
| **Test coverage?** | 51/51 passing | READY |
| **Production build?** | SUCCESS | READY |
| **Safe to merge?** | AFTER APPROVAL ONLY | DO NOT EXECUTE YET |

---

## PROTECTED BRANCHES & FILES

**Do NOT merge to origin/main until:**
1. Integration branch created from latest main
2. All 3 commits successfully applied
3. Full test suite passes
4. Prebuild runs clean (no source mutations)
5. User reviews and approves this report

**Do NOT execute integration without explicit approval.**

---

**Report Generated:** 2026-01-20
**Audit Complete:** ✓ Analysis only, no code changes executed
