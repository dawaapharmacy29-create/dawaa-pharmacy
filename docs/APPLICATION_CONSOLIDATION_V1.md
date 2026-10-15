# Application Consolidation V1 — Audit, Change Register and Final Map

Branch: `closure/application-consolidation-v1-20261015`
Base (`origin/main`): `45fd8d936bd82c68713e67685b85e997866d7955`

Scope: application *structure* only (navigation, page ownership, legacy surfaces,
permission alignment, fetching, loading/error states). The Sales Intelligence /
Master Brain architecture is frozen and was not modified. No production write,
migration, deploy or push was performed. Production was read with `begin read only`
SELECT statements only.

---

## Phase A — Audit

### A0. Baseline verification (before any change)

`npm run verify` on the untouched base: **985 passed, 4 failed**. The 4 failures are
Sales Intelligence Pipeline golden cases (#1, #4, #10, #12) and they all pass with
`TZ=Africa/Cairo` (989/989). Root cause: `parseWhatsAppExport` builds timestamps with
the process-local timezone (`new Date(y, m, d, h, …)`), and the golden fixtures are
authored in Cairo wall-clock. The container (and GitHub `ubuntu-latest`) run in UTC.

Production evidence (read-only): 106 of 116 `whatsapp_review_sources.raw_text` rows use
the dated native export format; persisted `sales_intelligence_cases.case_started_at`
matches Cairo wall-clock (e.g. `11/29/25, 1:08:07 PM` → `2025-11-29 11:08:07+00`, UTC+2
in winter). Production truth is therefore Cairo; the failure is a test-determinism
defect, not a live contract violation. See APP-001 / APP-002.

### A1. Route inventory (base)

| Metric | Value |
|---|---|
| TOTAL_ROUTES (incl. `/login`, `*`) | 114 |
| TOTAL_UNIQUE_ROUTES | 114 (no duplicate paths) |
| TOTAL_PAGE_COMPONENT FILES (`src/pages`) | 136 |
| Lazy page imports in `App.tsx` | 112 (1 unused: `StaffPayroll`) + 1 eager (`ExecutiveDashboardRoute`) |
| TOTAL_PARAMETERIZED_ROUTES | 5 (`/customers/:id`, `/staff/:id`, `/weekly-evaluation/:type`, `/sales-intelligence/qa/:caseId`, `/customer-health/:id`) |
| TOTAL_CONTEXTUAL_ROUTES (reached from other pages, not nav) | 14 |
| TOTAL_NON_SIDEBAR static routes | 25 |

Same-component routes: `/` ≡ `/executive-2027` (`ExecutiveDashboardRoute`);
`/customer-service` ≡ `/customer-service-classic` (`CustomerService.tsx` re-exports
`SmartCustomerService`); `/customers/:id` ≡ `/customer-360` (query-param variant,
contextual — kept).

Orphan routes (no link anywhere in the app, URL-only): `/customer-import`,
`/customer-incubation`, `/customer-welcome`, `/loyalty-tiers`, `/today-brief`,
`/returns`, `/offers`, `/stories`, `/training`.

Contextual routes (linked from pages/notifications, intentionally not in nav):
`/customer-service-dashboard`, `/evaluation-rules`, `/crm`, `/customer-service-credit`,
`/staff-dashboard`, `/daily-target`, `/refill-reminders`, `/expiry-discounts`,
`/supplier-performance`, `/stock-alerts`, `/diagnostics`, `/customer-360`,
`/customers/:id`, `/customer-health/:id`, `/staff/:id`, `/sales-intelligence/qa/:caseId`.

Orphan page files (no import anywhere): `AttendanceClock.tsx`, `StaffProfile2027.tsx`.
Page files kept only for gate scripts: `CustomerCashbackBase`, `CustomerServiceDoctorEvaluation`,
`WhatsAppConversationAnalyzer`, `WhatsAppReviewQueueV4`, `PayrollManagementV2` (live via re-export).

### A2. Sidebar inventory (base)

Computed by evaluating `SidebarBase` against `permissionSystem` for every role
(tool: per-role evaluation of `canAccess`, same rules as runtime):

| | Groups | Items |
|---|---|---|
| Defined (main) | 16 | 96 |
| Defined (pharmacist view) | 4 | 17 |
| general_manager | 15 | 89 (3 duplicate paths) |
| executive_manager | 15 | 87 (3 duplicate) |
| branches_manager | 15 | 90 (3 duplicate) |
| branch_manager | 15 | 72 (2 duplicate) |
| customer_service_manager | 12 | 32 (1 duplicate) |
| customer_service | 9 | 25 |
| procurement_manager | 5 | 16 |
| inventory_assistant | 5 | 14 |
| pharmacist / shift supervisors | 4 | 16 / 7 |
| cleaning_supervisor, delivery | 4 | 4 |

(`assistant` uses the separate `AssistantSidebar`, 4 groups / 15 items, unchanged.)

Findings:
- Duplicate entries: `/staff-monthly-evaluation` ×3, `/monthly-incentive-report` ×2,
  `/penalty-incentive` ×2; `/customer-service?quickFollowup=1` duplicates the quick-action button.
- 8 links into one page: `/attendance-report?tab=dashboard|daily|resolution|report|overtime|sync|unmapped|cross-branch`
  although the page owns real in-page tabs and alias deep links.
- WhatsApp / Sales Intelligence workflow split across 3 groups, one labelled "(تجريبي)".
- Pharmacist view: 6 links into `/doctor-dashboard?tab=…` (page owns in-page tabs).
- `Sidebar.tsx` mutated `ROLE_PERMISSION_PRESETS` and `ROUTE_PERMISSION_MAP` at import time
  (parallel permission source outside `permissionSystem.ts`).

### A3. Page generations

| Surface | Current | Legacy / compat | Status |
|---|---|---|---|
| Customer service | `SmartCustomerService` (`/customer-service`) | `CustomerService.tsx` re-export (`/customer-service-classic`) | COMPATIBILITY → redirect |
| WhatsApp ingest | `WhatsAppSmartFolderWatcher` | `WhatsAppFolderWatcher` (old auto-ingest generation, 60 s polling) | LEGACY → hidden |
| WhatsApp analytics | Sales Intelligence QA + `WhatsappAnalytics` | `WhatsAppDoctorPerformance`, `WhatsAppBranchComparison`, `WhatsAppLostOpportunities`, `WhatsAppCustomerHistory` (`whatsapp_*_v1` RPCs) | EXPERIMENTAL → hidden |
| WhatsApp follow-ups | Customer service center | `WhatsAppAutoFollowupRequests` (21 rows, all untouched) | EXPERIMENTAL → hidden |
| Executive dashboard | `ExecutiveDashboardRoute` (`/`) | `/executive-2027` alias | COMPATIBILITY → redirect |
| Payroll | `PayrollManagementV2` via `PayrollManagement` | `StaffPayroll.tsx` re-export (unused import) | COMPAT |
| Doctor dashboard | `DoctorDashboardStable` via `DoctorDashboardEnhanced` | — | CURRENT |
| Staff detail | `StaffDetail` → `StaffDetailLegacy` | `StaffProfile2027` (orphan) | orphan removed |
| Unreferenced UI | — | 24 `components/reviews/WhatsApp*V6…V24`, 15 customer-service panels, 3 staff panels, 6 hooks, 2 common components, `ExecutiveCustomerServiceKpiSync` (DOM-patching KPI, never mounted) | dead |

### A4. Page names

Mismatched route/heading/sidebar names: `/` ("لوحة الإدارة" vs "لوحة القيادة"),
`/quarterly-incentives` ("نظام وقواعد الحافز" vs route name "الحافز الشهري"),
`/attendance-report` ("الحضور" vs heading "الحضور والوقت"),
`/whatsapp-branch-comparison` route name "مقارنة الفروع" collides with `/branch-comparison`.

### A5/A6. Data source and analytics audit

| Truth | Canonical source | Finding |
|---|---|---|
| Sales | `dawaa_sales_invoices_dashboard_v1` / `salesInvoiceQueries` | No direct `sales_invoices` reads in pages/components/hooks; gate `check-sales-truth-separation` PASS. |
| Conversion / lost opportunity | Sales Intelligence canonical engines | **Conflict**: `whatsapp_doctor_performance_v1`, `whatsapp_branch_comparison_v1`, `whatsapp_lost_opportunities_v1` compute "conversion_rate" as share of `commercial_eligible`, match staff by regex-cleaned name and match invoices by customer name — a second, non-canonical conversion truth (APP-006). |
| Conversation evaluation | `conversation_sales_reviews` (`is_current`) | `WhatsappAnalytics` read a fixed 3000 rows with no server date/currentness bound and filtered dates in the browser (1,987 rows today → silent truncation after growth) (APP-007). |
| Staff | `staff` + `staffIdentityResolver` | Legacy WhatsApp RPCs re-implement name matching (hidden via APP-006). |
| Attendance / payroll / evaluation / incentives / purchases / inventory | existing canonical services + gate scripts | No new conflict found; all domain gates PASS. Incentive governance route permission conflicted with its DB contract (APP-003). |
| Customer-service KPI | `customer_service_daily_queue_mix_v1` | `ExecutiveCustomerServiceKpiSync` patched dashboard DOM with a fallback-chain count — dead (never mounted), removed (APP-015). |

### A7. Performance audit

| Risk | Item |
|---|---|
| HIGH | `WhatsappAnalytics`: up to 3000-row unbounded review read + whole-table realtime invalidation re-reading it (APP-007). |
| MEDIUM | `useAuth`: every mounted consumer (138 files use it) installed its own session-renew interval, visibility + storage listeners and 5 idle-activity listeners (APP-016). |
| MEDIUM | `useSupabaseQuery` realtime invalidated the first-render query key; after a filter change live updates refreshed nothing (stale query) (APP-008). |
| MEDIUM | `WhatsAppFolderWatcher` 60 s ingest polling on a legacy path reachable from nav (APP-006). |
| LOW | `DailyTarget` 5-min and attendance biometric 60-s polling continued while the tab was hidden (APP-022). |
| LOW | `SidebarRuntimePolish` body-subtree `MutationObserver` (only under `?addons=1`) targeting an element that no longer exists (APP-020). |

Network-level session refresh is already deduplicated (`verifyStoredStaffSession` cache +
in-flight promise; `refreshCurrentStaffAccount` TTL) — not a storm.

### A8. Permission audit

| Type | Finding |
|---|---|
| visible-but-denied | Experimental WhatsApp group visible to every `view_reviews` holder (e.g. `customer_service`), RPCs require `dawaa_can_manage_whatsapp_followups_v1` (customer-service evaluator identity) (APP-006). |
| visible-but-denied / hidden-but-accessible | `/incentive-governance`: sidebar + `ROUTE_PERMISSION_MAP` + DB use `manage_incentives`; `App.tsx` route prop overrode it with `manage_payroll` (APP-003). |
| landing denial | `customer_service` login at `/` redirected to `/customer-service-dashboard`, which requires `view_branch_dashboard`/`view_executive_dashboard` the role lacks → "no permission" landing (APP-005). |
| parallel source | `Sidebar.tsx` import-time mutation of presets/route map (APP-004). |
| cross-branch | Legacy `whatsapp_branch_comparison_v1` returns all branches for any evaluator — surface hidden (APP-006). |

### A9. Loading / error audit

- `PageSafetyBoundary`, `AppErrorBoundary` (stale-chunk reload guarded to once per 15 s),
  `PageLoadingFallback` (slow notice after 8 s), `DeploymentWatcher`: no loop found.
- Doctor dashboard "activity" tab: a failed `getEmployeeEvents` left the tab in `loading`
  forever with an unhandled rejection (APP-017).
- `WhatsAppAutoFollowupRequests`: silent v2→v1 RPC fallback (v2 exists in migrations and production) (APP-018).

### A10–A13. Workflows

- Executive daily: `/` → `/daily-command` → `/operations-center` → `/branch-inspection` — no change.
- HR / attendance: `/hr-workforce` → `/attendance-report` (tabs: overview, today, review box,
  log, biometric, my clock) → `/hr-data-quality` → `/hr-reports` → `/staff-payroll`.
  The 8 attendance links collapse to one "مركز الحضور" entry.
- Customer service: `/customer-service` (quick follow-up is the toolbar action) → `/customer-requests` → `/customer-coding`.
- WhatsApp (A11): INGEST + ANALYZE `/whatsapp-smart-folder-watcher` → REVIEW EXCEPTIONS
  `/sales-intelligence/qa` → FOLLOW-UP `/customer-service` → EVALUATION `/reviews` →
  ANALYTICS `/whatsapp-analytics`. Legacy-hidden: folder watcher, follow-up requests,
  doctor performance, customer history, lost opportunities, branch comparison.
- Payroll / incentives / points: one group (payroll, incentive summary, points, penalties,
  appeals, governance, exceptional bonus, rules).
- Purchases / inventory (A13): entry → review → accuracy → returns → cycle report →
  supplier accounts → order log; inventory: shortages, stagnant, expiry, counts, shelves,
  supplies, accessories, zone tasks, checklist review. No duplicates; unchanged.

---

## Final Change Register

| ID | Domain | Route / file | Problem | Root cause | Sev | Type | Fix | Risk | Test |
|---|---|---|---|---|---|---|---|---|---|
| APP-001 | Verify | `scripts/run-tests.cjs` | 4 SI golden cases (incl. #1) fail outside Cairo TZ | test runner inherits host TZ; fixtures are Cairo wall-clock | P1 | DATA | pin `TZ=Africa/Cairo` (business TZ, matches production truth) in the runner | none (test-only) | full suite in UTC host |
| APP-002 | SI runtime | `server/sales-intelligence-refresh-source.ts` | server parse of dated exports depends on process TZ | Vercel functions run UTC | P2 | DATA | **DEFERRED** — Master Brain frozen; needs an explicit contract decision + production evidence for server-refreshed rows | — | — |
| APP-003 | Incentives | `/incentive-governance` | route prop `manage_payroll` contradicts map/sidebar/DB `manage_incentives` | stale route override | P1 | PERMISSION | drop override; central map decides | low | route-permission test |
| APP-004 | Permissions | `Sidebar.tsx` | import-time mutation of presets and route map | parallel permission source | P1 | PERMISSION | move `view_operations` grant and the 4 route entries into `permissionSystem.ts` | low (same runtime result) | permission tests |
| APP-005 | Auth | `/` | `customer_service` lands on a denied page | redirect target needs `view_branch_dashboard` | P1 | PERMISSION | redirect `customer_service` to `/customer-service` | low | landing test |
| APP-006 | WhatsApp | 6 legacy WhatsApp routes | visible-but-denied; non-canonical conversion truth | experimental group kept in nav | P1 | LEGACY | remove from nav, legacy notice on page linking canonical surfaces, routes kept | low | nav test |
| APP-007 | Analytics | `/whatsapp-analytics` | 3000-row unbounded read, browser date filter, superseded rows counted | no server bound | P1 | ANALYTICS | server `review_date` range + `is_current` | low (numbers identical today) | source test |
| APP-008 | Fetching | `useSupabaseQuery` | realtime refreshes stale key | key captured at first render | P2 | PERFORMANCE | invalidate by table prefix | low | unit test |
| APP-009 | Attendance | sidebar | 8 links into one tabbed page | tabs represented as nav | P2 | NAVIGATION | single "مركز الحضور" entry; active-state fix | low | nav test |
| APP-010 | Payroll/eval | sidebar | 3 duplicate paths, split payroll/incentive groups | accumulated groups | P2 | NAVIGATION | merge groups, one entry per page | low | nav test |
| APP-011 | WhatsApp/SI | sidebar | workflow split across 3 groups | — | P2 | NAVIGATION | one ordered "واتساب وذكاء المبيعات" group | low | nav test |
| APP-012 | Doctor | pharmacist sidebar | 6 `?tab=` links | tabs as nav | P3 | NAVIGATION | keep dashboard + follow-ups | low | nav test |
| APP-013 | Routing | `/executive-2027`, `/customer-service-classic` | same component under two paths | compat aliases | P2 | LEGACY | redirect (query preserved) | low | route test |
| APP-014 | Names | `App.tsx` | route page names differ from nav/headings | drift | P4 | UI | align route names to nav labels | none | — |
| APP-015 | Cleanup | 55 UI files | unreferenced components/hooks/pages | dead generations | P3 | CODE_CLEANUP | delete (zero references incl. tests/scripts); drop unused lazy import | low (typecheck/build prove) | typecheck, build |
| APP-016 | Auth perf | `useAuth` | per-consumer session lifecycle listeners | lifecycle effects in a widely used hook | P2 | PERFORMANCE | ref-counted singleton lifecycle | low | unit test |
| APP-017 | Doctor | doctor dashboard | activity tab stuck loading on failure | missing catch | P2 | ERROR_HANDLING | catch → error state + message | none | source test |
| APP-018 | WhatsApp | follow-up requests | silent v2→v1 RPC fallback | compat code | P3 | DATA | call v2 only | low | source test |
| APP-019 | Routing | 9 orphan routes | no link anywhere | — | P4 | NAVIGATION | **DEFERRED** — product decision (keep URL-only, INTERNAL) | — | — |
| APP-020 | Cleanup | `SidebarRuntimePolish` | dead DOM patcher + body observer | stale add-on | P3 | CODE_CLEANUP | remove | none | build |
| APP-021 | Cleanup | ~60 orphan `src/lib` modules | unreferenced domain modules | — | P4 | CODE_CLEANUP | **DEFERRED** — domain layer near frozen SI; needs per-module tracing | — | — |
| APP-022 | Polling | `DailyTarget`, attendance biometric | polls while tab hidden | no visibility guard | P4 | PERFORMANCE | skip ticks while hidden | none | — |
| APP-023 | UI | all pages | header/filter/table primitives not uniform | historical | P5 | UI | **DEFERRED** — redesign outside minimal scope | — | — |
