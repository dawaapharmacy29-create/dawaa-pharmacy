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

---

## Phase B — Implementation (commits on the branch)

| Batch | Commit subject | Register items |
|---|---|---|
| 0 | test: pin the business timezone in the test runner | APP-001 |
| 1 | refactor: consolidate application navigation | APP-009, 010, 011, 012, 013, 014 |
| 2 | refactor: retire legacy application surfaces | APP-006, 015, 020 |
| 3 | fix: unify canonical analytics reads | APP-007, 018 |
| 4 | perf: reduce duplicated page data fetching and session listeners | APP-008, 016, 022 |
| 5 | fix: align route and data permissions; recover failed doctor activity reads | APP-003, 004, 005, 017 |
| 6 | docs: final application map (this section) | — |

New regression tests (registered in `scripts/run-tests.cjs`): `applicationNavigation`,
`applicationDataContracts`, `applicationPermissions`, `sessionLifecycleSingleton`, plus the
previously unregistered `appRoutes`.

## Final change report

| ID | Status |
|---|---|
| APP-001 | IMPLEMENTED |
| APP-002 | FIXED in the closure pass (re-rated P1: a UTC machine changed Golden Case #1 output) |
| APP-003 | IMPLEMENTED |
| APP-004 | IMPLEMENTED |
| APP-005 | IMPLEMENTED |
| APP-006 | IMPLEMENTED |
| APP-007 | IMPLEMENTED |
| APP-008 | IMPLEMENTED |
| APP-009 | IMPLEMENTED |
| APP-010 | IMPLEMENTED |
| APP-011 | IMPLEMENTED |
| APP-012 | IMPLEMENTED |
| APP-013 | IMPLEMENTED |
| APP-014 | IMPLEMENTED |
| APP-015 | IMPLEMENTED (50 files) |
| APP-016 | IMPLEMENTED |
| APP-017 | IMPLEMENTED |
| APP-018 | IMPLEMENTED |
| APP-019 | CLASSIFIED in the closure pass (7 kept as internal/legacy-hidden; 2 broken → APP-024) |
| APP-020 | IMPLEMENTED |
| APP-021 | CLASSIFIED in the closure pass (no deletion) |
| APP-022 | IMPLEMENTED |
| APP-023 | DEFERRED (P5 visual standardisation) |

The V25/V26 WhatsApp surface checks were retired in the closure pass (see below).

## Final sidebar map

| | Before | After |
|---|---|---|
| Groups (main) | 16 | 14 |
| Items (main) | 96 | 79 |
| Items (pharmacist view) | 17 | 13 |

Per role (visible groups/items, duplicate paths):

| Role | Before | After |
|---|---|---|
| general_manager | 15 / 89 (dup 3) | 13 / 72 (dup 0) |
| executive_manager | 15 / 87 (dup 3) | 13 / 70 (dup 0) |
| branches_manager | 15 / 90 (dup 3) | 13 / 73 (dup 0) |
| procurement_manager | 5 / 16 (dup 0) | 5 / 16 (dup 0) |
| branch_manager | 15 / 72 (dup 2) | 13 / 58 (dup 0) |
| customer_service_manager | 12 / 32 (dup 1) | 9 / 24 (dup 0) |
| shift_supervisor_morning | 4 / 7 (dup 0) | 4 / 7 (dup 0) |
| shift_supervisor_evening | 4 / 7 (dup 0) | 4 / 7 (dup 0) |
| pharmacist | 4 / 16 (dup 0) | 4 / 12 (dup 0) |
| inventory_assistant | 5 / 14 (dup 0) | 5 / 14 (dup 0) |
| customer_service | 9 / 25 (dup 0) | 7 / 18 (dup 0) |
| assistant | 6 / 9 (dup 0) | 6 / 9 (dup 0) |
| cleaning_supervisor | 4 / 4 (dup 0) | 4 / 4 (dup 0) |
| delivery | 4 / 4 (dup 0) | 4 / 4 (dup 0) |

`assistant` uses `AssistantSidebar` (unchanged). The delivery group stays behind
`ENABLE_INTERNAL_DELIVERY_MODULE = false` (Delivery not touched).

**الرئيسية والإدارة**
- لوحة القيادة → `/`
- الأمر اليومي → `/daily-command`
- مركز المهام والتنبيهات → `/operations-center`
- متابعة ومرور الفروع → `/branch-inspection`

**الموارد البشرية**
- مركز الموارد البشرية → `/hr-workforce`
- دليل الموظفين → `/team`
- ملف الموظف الوظيفي → `/hr-staff-milestones`
- الجداول والمناوبات → `/schedule`
- الإجازات والغياب → `/time-off`
- حضوري → `/my-attendance`

**الحضور والوقت**
- مركز الحضور → `/attendance-report`
- جودة بيانات الموارد البشرية → `/hr-data-quality`
- تقارير الموارد البشرية → `/hr-reports`
- إعدادات الموارد البشرية → `/hr-settings`

**الرواتب والنقاط والحوافز**
- الرواتب والجاهزية → `/staff-payroll`
- ملخص الحوافز الشهري → `/monthly-incentive-report`
- نقاط الأداء → `/points`
- الجزاءات والمكافآت → `/penalty-incentive`
- اعتراضات النقاط → `/point-appeals`
- اعتماد الحوافز → `/incentive-governance`
- المكافآت الاستثنائية → `/assistant-operational-bonus`
- نظام وقواعد الحافز → `/quarterly-incentives`

**الأداء والتقييمات**
- مؤشرات الموظفين → `/employee-kpi`
- مؤشر الأداء الشامل → `/performance-pillars`
- ملخص أداء الدكاترة → `/doctor-quality-summary`
- تقييم أداء الشيفتات → `/shift-performance`
- التقييم الشهري للدكاترة وخدمة العملاء → `/staff-monthly-evaluation`
- تقييم الدكاترة من خدمة العملاء → `/staff-monthly-evaluation`
- تقييم مدير الفرع → `/weekly-evaluation/branch_manager`
- تقييم مدير الفروع → `/weekly-evaluation/branches_manager`
- تقييم فريق خدمة العملاء ودواء ألفا → `/weekly-evaluation/customer_service`

**خدمة العملاء والمتابعات**
- مركز خدمة العملاء → `/customer-service`
- طلبات العملاء → `/customer-requests`
- تكويد العملاء → `/customer-coding`
- الردود السريعة → `/quick-replies`
- رسائل الترحيب → `/welcome-messages`

**واتساب وذكاء المبيعات**
- التقاط وتحليل محادثات واتساب → `/whatsapp-smart-folder-watcher`
- مراجعة حالات ذكاء المبيعات → `/sales-intelligence/qa`
- تقييم المحادثات → `/reviews`
- تحليلات واتساب → `/whatsapp-analytics`

**العملاء ونقاط الولاء**
- قاعدة العملاء → `/customers`
- أداء العملاء الشهري → `/customer-monthly-performance`
- مراجعة بيانات العملاء → `/customer-data-review`
- نقاط العملاء من الفواتير → `/customer-cashback`
- سجل حركات نقاط العملاء → `/customer-points-ledger`

**المبيعات والتقارير**
- لوحة المبيعات والتحليلات → `/analytics`
- مقارنة أداء الفروع → `/branch-comparison`
- أداء ومنافسة الدكاترة → `/doctor-competition`
- تقرير الأداء الشهري 360° → `/monthly-report-360`
- مركز التقارير → `/reports`

**الفواتير والمشتريات**
- استيراد فواتير المبيعات → `/invoices`
- المشتريات → `/purchases`
- إدخال فاتورة مشتريات → `/purchase-invoice-entry`
- مراجعة فواتير المشتريات → `/purchase-invoice-review`
- دقة إدخال فواتير المشتريات → `/purchase-invoice-accuracy`
- مرتجعات المشتريات → `/purchase-returns`
- تقرير دورة المشتريات → `/purchase-cycle-report`
- حسابات الموردين → `/supplier-accounts`
- سجل الطلبيات → `/purchase-order-log`
- تسليم الشيفتات → `/shift-handovers`

**المخزون وتشغيل الصيدلية**
- النواقص → `/shortages`
- الرواكد → `/stagnant-medicines`
- متابعة الصلاحية → `/medicine-expiry`
- الجرد → `/inventory-counts`
- تنظيم ورص الأرفف → `/shelf-organization`
- متابعة المستلزمات → `/supplies`
- متابعة الإكسسوارات → `/accessories`
- الرص والجرد اليومي → `/pharmacy-zone-tasks`
- مراجعة النظافة والرص والجرد → `/branch-checklist-review`

**المهام والتشغيل اليومي**
- مهام الفريق → `/employee-operating-system`
- مهامي اليومية → `/my-daily-checklist`
- سجل أعمال المساعد → `/assistant-operational-log`
- مهام الإدارة اليومية → `/daily-manager-checklist`

**إدارة النظام**
- الحسابات والصلاحيات → `/staff-accounts`
- إعدادات الأدوار والصلاحيات → `/roles-permissions`
- تدقيق الحسابات والتكرار → `/staff-duplicate-audit`
- صحة البيانات → `/data-health`
- سجل أنشطة النظام → `/activity-log`

**التوصيل**
- إدارة الدليفري → `/delivery`

## Final application map

TOTAL_ROUTES before 114 → after 114 (2 converted to compatibility redirects; no route deleted).
Page component files: 136 → 134.

| ROUTE | FINAL_PAGE_NAME | DOMAIN | SIDEBAR_GROUP | PERMISSION | STATUS |
|---|---|---|---|---|---|
| `/login` | تسجيل الدخول | Core/Admin | — | — | INTERNAL |
| `/` | لوحة القيادة | Core/Admin | الرئيسية والإدارة | view_dashboard | ACTIVE_PRIMARY |
| `/executive-2027` | — | Core/Admin | — | — | LEGACY_HIDDEN (redirect → /) |
| `/customer-service-dashboard` | لوحة مديرة خدمة العملاء | Customers/CS | — | [view_branch_dashboard, view_executive_dashboard] | ACTIVE_CONTEXTUAL |
| `/doctor-dashboard` | لوحة الدكتور | Core/Admin | — | view_doctor_dashboard | ACTIVE_CONTEXTUAL |
| `/branch-comparison` | مقارنة الفروع | Sales/Reports | المبيعات والتقارير | view_branch_comparison | ACTIVE_PRIMARY |
| `/branch-inspection` | مرور مدير الفروع | Core/Admin | الرئيسية والإدارة | view_branch_inspection | ACTIVE_PRIMARY |
| `/evaluation-rules` | قواعد التقييم | Performance | — | manage_evaluation_rules | ADMIN_ONLY (contextual) |
| `/point-appeals` | اعتراضات النقاط | Payroll/Incentives | الرواتب والنقاط والحوافز | view_points | ACTIVE_PRIMARY |
| `/performance-pillars` | الدرجة المركّبة للأداء | Performance | الأداء والتقييمات | view_team | ACTIVE_PRIMARY |
| `/doctor-quality-summary` | ملخص أداء الدكاترة | Performance | الأداء والتقييمات | view_team | ACTIVE_PRIMARY |
| `/weekly-evaluation/:type` | التقييم الأسبوعي | Performance | الأداء والتقييمات | prefix rule | ACTIVE_PRIMARY |
| `/daily-manager-checklist` | المهام اليومية | Inventory/Ops | المهام والتشغيل اليومي | view_team | ACTIVE_PRIMARY |
| `/customer-monthly-performance` | أداء العملاء الشهري | Performance | العملاء ونقاط الولاء | view_analytics | ACTIVE_PRIMARY |
| `/quarterly-incentives` | نظام وقواعد الحافز | Payroll/Incentives | الرواتب والنقاط والحوافز | view_quarterly_incentives | ACTIVE_PRIMARY |
| `/operations-center` | مركز العمليات | Core/Admin | الرئيسية والإدارة | view_operations | ACTIVE_PRIMARY |
| `/data-health` | صحة البيانات | Core/Admin | إدارة النظام | view_data_health | ADMIN_ONLY |
| `/customers` | العملاء | Customers/CS | العملاء ونقاط الولاء | view_customers | ACTIVE_PRIMARY |
| `/customers/:id` | ملف العميل | Customers/CS | — | prefix rule | ACTIVE_CONTEXTUAL |
| `/customer-360` | ملف العميل | Customers/CS | — | view_customer_360 | ACTIVE_CONTEXTUAL |
| `/customer-import` | استيراد العملاء | Customers/CS | — | import_customers | INTERNAL (URL-only) |
| `/customer-service` | خدمة العملاء | Customers/CS | خدمة العملاء والمتابعات | view_customer_service | ACTIVE_PRIMARY |
| `/customer-service-classic` | — | Customers/CS | — | — | LEGACY_HIDDEN (redirect → /customer-service) |
| `/whatsapp-followup-requests` | طلبات المتابعة الآلية | WhatsApp/SI | — | view_reviews | LEGACY_HIDDEN |
| `/whatsapp-folder-watcher` | المراقبة التلقائية للواتساب | WhatsApp/SI | — | view_reviews | LEGACY_HIDDEN |
| `/whatsapp-doctor-performance` | أداء الدكاترة في الواتساب | WhatsApp/SI | — | view_reviews | LEGACY_HIDDEN |
| `/whatsapp-customer-history` | سجل محادثات العميل | WhatsApp/SI | — | view_reviews | LEGACY_HIDDEN |
| `/whatsapp-lost-opportunities` | الفرص الضائعة | WhatsApp/SI | — | view_reviews | LEGACY_HIDDEN |
| `/whatsapp-branch-comparison` | مقارنة الفروع (واتساب) | WhatsApp/SI | — | view_reviews | LEGACY_HIDDEN |
| `/customer-requests` | طلبات العملاء | Customers/CS | خدمة العملاء والمتابعات | view_customer_requests | ACTIVE_PRIMARY |
| `/customer-incubation` | احتضان العملاء | Customers/CS | — | view_customer_incubation | INTERNAL (URL-only) |
| `/customer-data-review` | مراجعة بيانات العملاء | Customers/CS | العملاء ونقاط الولاء | view_customer_details | ACTIVE_PRIMARY |
| `/crm` | CRM | Customers/CS | — | view_crm | ACTIVE_CONTEXTUAL |
| `/customer-cashback` | كاش باك العملاء | Customers/CS | العملاء ونقاط الولاء | view_cashback | ACTIVE_PRIMARY |
| `/customer-service-credit` | رصيد خدمة العملاء | Customers/CS | — | view_customer_service | ACTIVE_CONTEXTUAL |
| `/customer-points-ledger` | سجل نقاط العملاء | Payroll/Incentives | العملاء ونقاط الولاء | view_points | ACTIVE_PRIMARY |
| `/welcome-messages` | رسائل الترحيب | Customers/CS | خدمة العملاء والمتابعات | customer_welcome_messages_view | ACTIVE_PRIMARY |
| `/customer-welcome` | ترحيب العملاء | Customers/CS | — | customer_welcome_messages_view | INTERNAL (URL-only) |
| `/customer-coding` | تكويد العملاء | Customers/CS | خدمة العملاء والمتابعات | view_customer_service | ACTIVE_PRIMARY |
| `/quick-replies` | الردود السريعة | Customers/CS | خدمة العملاء والمتابعات | whatsapp_customer | ACTIVE_PRIMARY |
| `/my-daily-checklist` | التشيك ليست اليومي | Inventory/Ops | المهام والتشغيل اليومي | view_dashboard | ACTIVE_PRIMARY |
| `/assistant-operational-log` | تسجيل عمليات المشتريات وخدمة العملاء | Core/Admin | المهام والتشغيل اليومي | view_dashboard | ACTIVE_PRIMARY |
| `/assistant-operational-bonus` | مكافأة تميز مفاجئة | Payroll/Incentives | الرواتب والنقاط والحوافز | manage_incentives | ACTIVE_PRIMARY |
| `/pharmacy-zone-tasks` | الرص والجرد اليومي | Inventory/Ops | المخزون وتشغيل الصيدلية | view_dashboard | ACTIVE_PRIMARY |
| `/purchase-invoice-accuracy` | دقة إدخال فواتير المشتريات | Purchases | الفواتير والمشتريات | view_dashboard | ACTIVE_PRIMARY |
| `/purchase-invoice-entry` | تسجيل فاتورة مشتريات | Purchases | الفواتير والمشتريات | view_dashboard | ACTIVE_PRIMARY |
| `/purchase-invoice-review` | مراجعة فواتير المشتريات | Purchases | الفواتير والمشتريات | view_team | ACTIVE_PRIMARY |
| `/purchase-returns` | مرتجعات المشتريات | Purchases | الفواتير والمشتريات | view_purchases | ACTIVE_PRIMARY |
| `/purchase-cycle-report` | تقرير دورة المشتريات | Purchases | الفواتير والمشتريات | view_purchases | ACTIVE_PRIMARY |
| `/supplier-accounts` | حسابات الموردين | Purchases | الفواتير والمشتريات | view_purchases | ACTIVE_PRIMARY |
| `/purchase-order-log` | سجل الطلبيات | Purchases | الفواتير والمشتريات | view_purchases | ACTIVE_PRIMARY |
| `/shift-handovers` | تسليم الشيفتات | Purchases | الفواتير والمشتريات | view_purchases | ACTIVE_PRIMARY |
| `/branch-checklist-review` | مراجعة التشيك ليست | Inventory/Ops | المخزون وتشغيل الصيدلية | view_team | ACTIVE_PRIMARY |
| `/doctor-competition` | مسابقة الدكاترة | Sales/Reports | المبيعات والتقارير | view_doctor_dashboard | ACTIVE_PRIMARY |
| `/team` | الفريق | HR/Attendance | الموارد البشرية | view_team | ACTIVE_PRIMARY |
| `/schedule` | الجدول | HR/Attendance | الموارد البشرية | view_schedule | ACTIVE_PRIMARY |
| `/points` | النقاط | Payroll/Incentives | الرواتب والنقاط والحوافز | view_points | ACTIVE_PRIMARY |
| `/delivery` | الدليفري | Delivery | التوصيل | view_delivery | ACTIVE_PRIMARY |
| `/analytics` | التحليلات | Sales/Reports | المبيعات والتقارير | view_analytics | ACTIVE_PRIMARY |
| `/invoices` | الفواتير | Sales/Reports | الفواتير والمشتريات | [view_invoices, view_invoice_import] | ACTIVE_PRIMARY |
| `/activity-log` | سجل الأنشطة | Core/Admin | إدارة النظام | view_activity_log | ADMIN_ONLY |
| `/reviews` | التقييمات | WhatsApp/SI | واتساب وذكاء المبيعات | view_reviews | ACTIVE_PRIMARY |
| `/whatsapp-smart-folder-watcher` | التقاط وتحليل محادثات واتساب | WhatsApp/SI | واتساب وذكاء المبيعات | view_reviews | ACTIVE_PRIMARY |
| `/sales-intelligence/qa` | مراجعة حالات ذكاء المبيعات | WhatsApp/SI | واتساب وذكاء المبيعات | view_reviews | ACTIVE_PRIMARY |
| `/sales-intelligence/qa/:caseId` | تفاصيل الحالة | WhatsApp/SI | — | prefix rule | ACTIVE_CONTEXTUAL |
| `/shift-performance` | تقييم الشيفت | Performance | الأداء والتقييمات | view_shift_performance | ACTIVE_PRIMARY |
| `/staff-monthly-evaluation` | التقييم الشهري | Performance | الأداء والتقييمات | view_team | ACTIVE_PRIMARY |
| `/monthly-incentive-report` | ملخص الحوافز الشهري | Payroll/Incentives | الرواتب والنقاط والحوافز | view_team | ACTIVE_PRIMARY |
| `/shift-notes` | ملاحظات الشيفت | HR/Attendance | — | view_schedule | ACTIVE_CONTEXTUAL |
| `/staff/:id` | تفاصيل الموظف | HR/Attendance | — | view_staff_details | ACTIVE_CONTEXTUAL |
| `/time-off` | الأذونات | HR/Attendance | الموارد البشرية | [view_attendance_leaves] | ACTIVE_PRIMARY |
| `/my-attendance` | حضوري | HR/Attendance | الموارد البشرية | record_attendance | ACTIVE_PRIMARY |
| `/stagnant-medicines` | الرواكد | Inventory/Ops | المخزون وتشغيل الصيدلية | view_stagnant_medicines | ACTIVE_PRIMARY |
| `/incentive-medicines` | اللستة | Payroll/Incentives | — | view_incentive_medicines | ACTIVE_CONTEXTUAL |
| `/staff-accounts` | حسابات الموظفين | Core/Admin | إدارة النظام | view_staff_accounts | ADMIN_ONLY |
| `/staff-duplicate-audit` | مراجعة التكرار | Core/Admin | إدارة النظام | view_staff_accounts | ADMIN_ONLY |
| `/staff-payroll` | الرواتب والجاهزية | Payroll/Incentives | الرواتب والنقاط والحوافز | manage_payroll | ACTIVE_PRIMARY |
| `/incentive-governance` | اعتماد الحوافز | Payroll/Incentives | الرواتب والنقاط والحوافز | manage_incentives | ACTIVE_PRIMARY |
| `/penalty-incentive` | الجزاءات والمكافآت | Payroll/Incentives | الرواتب والنقاط والحوافز | view_penalty_management | ACTIVE_PRIMARY |
| `/staff-dashboard` | لوحة الموظف | HR/Attendance | — | view_team | ACTIVE_CONTEXTUAL |
| `/roles-permissions` | الأدوار والصلاحيات | Core/Admin | إدارة النظام | view_roles_permissions | ADMIN_ONLY |
| `/shelf-organization` | تنظيم الأرفف | Inventory/Ops | المخزون وتشغيل الصيدلية | view_inventory | ACTIVE_PRIMARY |
| `/inventory-counts` | الجرد | Inventory/Ops | المخزون وتشغيل الصيدلية | view_inventory | ACTIVE_PRIMARY |
| `/shortages` | النواقص | Inventory/Ops | المخزون وتشغيل الصيدلية | view_shortages | ACTIVE_PRIMARY |
| `/supplies` | المستلزمات | Inventory/Ops | المخزون وتشغيل الصيدلية | view_supplies | ACTIVE_PRIMARY |
| `/purchases` | المشتريات | Purchases | الفواتير والمشتريات | view_purchases | ACTIVE_PRIMARY |
| `/accessories` | الإكسسوارات | Inventory/Ops | المخزون وتشغيل الصيدلية | [view_inventory, manage_operations] | ACTIVE_PRIMARY |
| `/offers` | العروض | Core/Admin | — | manage_operations | INTERNAL (URL-only) |
| `/stories` | القصص | Core/Admin | — | manage_operations | INTERNAL (URL-only) |
| `/training` | التدريب | Core/Admin | — | manage_operations | INTERNAL (URL-only) |
| `/whatsapp-analytics` | تحليلات واتساب | WhatsApp/SI | واتساب وذكاء المبيعات | view_reviews | ACTIVE_PRIMARY |
| `/medicine-expiry` | الصلاحية | Inventory/Ops | المخزون وتشغيل الصيدلية | view_expiry_tracker | ACTIVE_PRIMARY |
| `/attendance-report` | مركز الحضور | HR/Attendance | الحضور والوقت | [view_attendance_leaves, record_attendance] | ACTIVE_PRIMARY |
| `/loyalty-tiers` | درجات الولاء | Customers/CS | — | view_loyalty_tiers | INTERNAL (URL-only) |
| `/daily-command` | الأمر اليومي | Core/Admin | الرئيسية والإدارة | view_dashboard | ACTIVE_PRIMARY |
| `/daily-target` | الهدف اليومي | Core/Admin | — | view_dashboard | ACTIVE_CONTEXTUAL |
| `/today-brief` | ملخص اليوم | Core/Admin | — | view_dashboard | INTERNAL (URL-only) |
| `/refill-reminders` | تذكير إعادة الشراء | Customers/CS | — | view_customers | ACTIVE_CONTEXTUAL |
| `/customer-health/:id` | الملف الصحي | Customers/CS | — | prefix rule | ACTIVE_CONTEXTUAL |
| `/expiry-discounts` | خصومات الصلاحية | Inventory/Ops | — | view_expiry_tracker | ACTIVE_CONTEXTUAL |
| `/employee-kpi` | مؤشرات الموظف | Performance | الأداء والتقييمات | view_team | ACTIVE_PRIMARY |
| `/hr-workforce` | مركز الموارد البشرية | HR/Attendance | الموارد البشرية | view_attendance_leaves | ACTIVE_PRIMARY |
| `/hr-staff-milestones` | مهام ملف الموظف | HR/Attendance | الموارد البشرية | view_attendance_leaves | ACTIVE_PRIMARY |
| `/hr-data-quality` | جودة بيانات الموارد البشرية | HR/Attendance | الحضور والوقت | view_attendance_leaves | ACTIVE_PRIMARY |
| `/hr-reports` | تقارير الموارد البشرية | HR/Attendance | الحضور والوقت | view_attendance_leaves | ACTIVE_PRIMARY |
| `/hr-settings` | إعدادات الموارد البشرية | HR/Attendance | الحضور والوقت | view_attendance_leaves | ACTIVE_PRIMARY |
| `/employee-operating-system` | نظام تشغيل الموظف | Core/Admin | المهام والتشغيل اليومي | employee_operating_system_view | ACTIVE_PRIMARY |
| `/supplier-performance` | أداء الموردين | Performance | — | view_purchases | ACTIVE_CONTEXTUAL |
| `/reports` | مركز التقارير | Sales/Reports | المبيعات والتقارير | view_sales_reports | ACTIVE_PRIMARY |
| `/monthly-report-360` | تقرير الأداء الشهري 360° | Sales/Reports | المبيعات والتقارير | [view_sales_reports, view_doctor_dashboard] | ACTIVE_PRIMARY |
| `/stock-alerts` | تنبيهات المخزون | Inventory/Ops | — | view_inventory | ACTIVE_CONTEXTUAL |
| `/returns` | المرتجعات | Sales/Reports | — | view_invoices | INTERNAL (URL-only) |
| `/diagnostics` | التشخيص | Core/Admin | — | view_diagnostics | ADMIN_ONLY (contextual) |
| `*` | الصفحة | Core/Admin | — | — | INTERNAL |

Status totals: INTERNAL=11, ACTIVE_PRIMARY=71, LEGACY_HIDDEN=8, ACTIVE_CONTEXTUAL=17, ADMIN_ONLY=7 (routes=114)


---

## Closure pass

### 1. APP-002 — timezone (FIXED)

Timestamp path: raw WhatsApp clock → `whatsappConversationParser` (`timestampFromPrefix` for native
`[m/d/yy, h:mm AM]` exports, `parseMarkdownTime` for dated markdown, trusted-anchor arithmetic for
time-only markdown) → `parseWhatsAppExport` (native exports are re-anchored to the trusted DB
`conversation_started_at`) → segmentation / canonical cases → invoice candidate window
(`buildInvoiceCandidateQuery`, pure millisecond arithmetic) → persisted `timestamptz` columns and
`month_cycle` (`monthCycleFromDate`).

| Question | Answer |
|---|---|
| Where is Cairo wall-clock interpreted? | Before: implicitly, by the machine timezone (`new Date(y, m - 1, d, h, …)`). After: explicitly, `cairoWallClockToDate` in `src/lib/time/cairoDateBoundary.ts`. |
| Where does it become UTC? | At that same call: the result is an absolute instant; everything downstream is millisecond arithmetic and ISO/timestamptz. |
| Could Vercel (UTC) differ from local? | Yes, before the fix. Proven: on the pre-fix code a UTC machine turned Golden Case #1 from `needs_human_review` into `analyzed` and every timezone produced a different canonical hash. Production rows were correct only because every source (116/116) carries a trusted `conversation_started_at` written by a Cairo browser and none sit on a month-cycle boundary. |
| Is pinning TZ in the test runner enough? | No — it hid the bug. The pin was removed; the code is now machine-independent and the suite passes in any timezone. |
| Machine-timezone Date usage left? | AST scan of every module bundled into the server API, all of `src/lib/salesIntelligence` and the WhatsApp libs: no local-component constructor or local getter remains on the canonical path. Remaining `Date.parse` calls read `timestamptz` values (offset included). Browser-side follow-up window, display day grouping and follow-up due dates were also made Cairo-explicit. `trustedDateParts` uses UTC calendar parts for a display label only (deterministic). |
| Same canonical output under UTC and Cairo? | Yes. `scripts/check-timezone-independence.cjs` (now part of `npm test`) runs Golden Case #1 and 41 WhatsApp fixtures through the real pipeline under UTC, Africa/Cairo, Asia/Tokyo and America/New_York: one canonical hash, Golden Case #1 = `needs_human_review` in all four. The post-fix hash equals the pre-fix Cairo hash, so Cairo semantics are unchanged. |

Equivalence proof for the helper: 280,512 wall-clock readings (every 15 min, 2024–2027, both sides
of every DST transition) match `new Date(y, m - 1, d, h, mi)` on a Cairo machine exactly; the browser
helpers' replacements match their old Cairo-machine results on 198,877 cases. No sale-proof,
invoice-ownership, segmentation or scoring rule changed. The generated server API changed only in
the timestamp boundary.

Observation (not timezone, not changed): 56 `conversation_sales_reviews` rows have a `month_cycle`
that disagrees with `review_date`, 47 of them by more than 40 days — a historical data-quality issue,
recorded as APP-025.

### 2. V25 / V26 checks

| Script | Validates | Current contract | Verdict | Action |
|---|---|---|---|---|
| `check-whatsapp-governance-v25` | V25 governance panel imported/rendered by `WhatsAppReviewQueueV4`; governance lib strings; resolver ambiguity guard; scoring `review_required` | the page has no route and the panel renders nowhere; resolver and scoring are live | STALE (surface) / VALID (two live safeguards) | moved to `scripts/retired/` (exits `RETIRED`); live no-guess resolution now covered by the registered behavioural test `whatsappResolverNoGuess`; `review_required` already covered by `whatsappSmartOfficialReviewDraft` |
| `check-whatsapp-deep-intelligence-v26` | V26 panels wired into `WhatsAppReviewQueueV4` and `WhatsAppConversationAnalyzer` | both pages unrouted; V26 panels/lib used by nothing that renders | STALE | moved to `scripts/retired/` (exits `RETIRED`) |

Neither was ever called by `npm test`, `verify`, `prebuild` or a workflow. KNOWN_VALID_FAILING_CHECKS = 0
(every `scripts/check-*.cjs` passes).

### 3. Deleted files

All 51 deleted files (50 UI + `SidebarRuntimePolish`): no reference in `src`, tests, scripts,
`server`, `api`, configs (`vite.config.ts`, `tsconfig*`, `index.html`, `vercel.json`, `public/`),
no barrel re-export, no template-string `import()`/`require()`, no `import.meta.glob`. Only
documentation mentions remain; the SI operational audit's release-candidate gate already recorded
the three V10/V11/V24 panels as "not imported anywhere". Typecheck, build and the full suite pass.

### 4. Redirects

`/executive-2027` → `/`, `/customer-service-classic` → `/customer-service`: query string and hash are
preserved; targets are distinct non-redirecting routes (no loop); the target's own `ProtectedRoute`
applies (same permission for customer service; stricter for `/`, which now also applies role
landing). Production `notifications`, `app_notifications` and `employee_events` hold no link to either
path. The only pathname check (`ExecutiveCustomerServiceKpiSync`) is in a component that is never mounted.

### 5. Orphan routes

| Route | Evidence | Class |
|---|---|---|
| `/customer-import` | only customer bulk-import tool (`customerBulkImport`), `import_customers` (sensitive) | INTERNAL_TOOL |
| `/loyalty-tiers` | loyalty tier report (`loyaltyTiersService`) linking to customer 360 | INTERNAL_TOOL |
| `/customer-incubation` | 1 case ever in `customer_incubation_cases` | LEGACY_HIDDEN |
| `/customer-welcome` | `customer_welcome_tasks` empty; superseded by `/welcome-messages` | LEGACY_HIDDEN |
| `/offers`, `/stories`, `/training` | `offers`, `whatsapp_stories`, `training_modules` empty | LEGACY_HIDDEN |
| `/returns` | writes `return_orders` — table exists neither in production nor in migrations | ORPHAN_REAL (broken) |
| `/today-brief` | calls `get_today_command_summary` — function exists neither in production nor in migrations | ORPHAN_REAL (broken) |

ORPHAN_REAL = 2 (APP-024, P3): URL-only, no nav or link, fail visibly (error state), kept untouched
pending a product decision (provision the backend or retire the route).

### 6. Unused `src/lib` modules (56, none deleted)

| Class | Modules |
|---|---|
| POTENTIAL_DYNAMIC_USE / gate-read (keep) | `reconcileWorker` (Vite `new Worker(new URL(...))`), `notifications/notificationActionService`, `notifications/notificationMetadata` (read by `check-notification-architecture`), `rolePermissionPresets`, `staffPermissions` (read by `check-permission-architecture`), `salesMetrics` (semantic-lint audit list), `src/types/legacyTaskTypeCompat.d.ts` (ambient types) |
| SHARED_BUT_CURRENTLY_UNUSED | `core/dateCycle`, `core/money`, `core/normalize`, `core/supabasePagination`, `core/permissions`, `permissions` (compat re-exports), `supabaseIdentity`, `supabasePaged`, `api/customerRequestsCommandCenter` (compat bridge), `sales/salesTruthService`, `sales/sharedSalesSummaryService`, `customers/sharedCustomerMetricsService`, `incentives/sharedIncentivePayoutService`, `performance/performanceReportService`, `performance/permissionPolicy`, `performance/repetitionPolicy`, `readModels/staffPerformanceProjection`, `dashboard/dashboardRpcClient`, `dataSources`, `salesIntelligence/doctorCommercialCycleRepositoryV1`, `salesIntelligence/legacyOpportunityAdapter` (SI, frozen), `attendance/locationAttendanceService`, `staff/staffDataExportService`, `staff/staffPdfReportService`, `monthlyPDFReport` |
| SAFE_LEGACY | `whatsappAnalysisScope`, `whatsappOrderLifecycleV19`, `whatsappPerformanceV4`, `whatsappReviewDecisionSupport`, `whatsappReviewFrameworkV3`, `dashboardFromInvoices`, `dashboardMetrics`, `branchMetrics`, `staffMetrics`, `salesInvoiceItemsV21`, `api/customerInvoiceMetricsPatch`, `classificationService`, `celebration`, `customerBranchOverrides`, `customerServiceSmartFollowup`, `customerUtils`, `dailyFollowupGenerator`, `followups`, `api/followups`, `followupScripts`, `incentiveDrugs` |
| UNKNOWN | `whatsappTemplates`, `operatingPolicy`, `pointsMoneyAudit` |

### Closure-pass register additions

| ID | Sev | Status |
|---|---|---|
| APP-002 | P1 (re-rated) | FIXED |
| APP-024 `/returns`, `/today-brief` reference missing backend objects | P3 | DEFERRED — product decision |
| APP-025 56 historical `month_cycle` / `review_date` mismatches | P3 | DEFERRED — production data, out of scope (read-only) |
| APP-026 stale V25/V26 checks | P3 | FIXED (retired, live safeguard tested) |
