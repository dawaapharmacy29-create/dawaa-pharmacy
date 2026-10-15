# Navigation workspaces — 2026-10-15

Branch: `feat/navigation-workspaces-20261015`, based on production main `d2d1e81a24d24e8772dab6feefa4d6af7cefe0aa`.

## Scope and boundary

Reorganize existing navigation into seven business groups plus reports/settings/account. Sections are expandable navigation, not new data dashboards or merged calculation engines. Existing routes, page loading, service authorization, database policies, and data remain intact. No page is mounted by opening a navigation section.

| Group | Sections |
| --- | --- |
| الإدارة | لوحة الإدارة، القيادة اليومية |
| الموظفون | الموظفون والملفات، الحضور والوقت، الجداول والإجازات، التقييمات والأداء، الرواتب والحوافز |
| العملاء وخدمة العملاء | العملاء، المتابعات والطلبات، ولاء العملاء، قوالب الرسائل |
| المحادثات وذكاء المبيعات | تقييم المحادثات وحالات البيع، تحليلات واتساب، التقاط المحادثات، أدوات وتقارير تجريبية |
| المبيعات | المبيعات والفواتير |
| المشتريات والمخزون | المشتريات، الموردون، المخزون والأصناف |
| تشغيل الفروع | مهام التشغيل، متابعة الفروع، ملاحظات وتسليم الشيفتات |
| التقارير والإعدادات | التقارير، الإعدادات وإدارة النظام، حسابي |

## Permission and interaction guarantees

- Apply original per-link role/permission/HR/biometric checks before deduplicating identical URLs. This preserves role-specific evaluation variants.
- Keep experimental tools reachable under an explicit experimental section; do not delete data or routes.
- Preserve unsaved-change navigation guard in the main sidebar, mobile close behavior, and shift-note pending counts.
- Preserve the separate assistant/pharmacist navigation. Improve assistant labels and query-aware active state. Hide the pharmacist notification shortcut while the subsystem is paused.
- Single-item sections render as direct links. Active groups/sections open automatically. Buttons expose expanded state, links expose titles and query-aware current-page state.
- Keep customer loyalty separate from employee performance points. Keep operational shift notes separate from financial shift handovers.
- No automatic publishing: disable Vercel Git deployment for this branch by exact branch name. No main merge or manual deployment.

## Headings

Align daily leadership, payroll readiness, quarterly incentives, and staff-duplicate audit headings with their navigation labels. Use accurate existing-content labels for purchases, employee indicators, customer followups, and composite performance.

## Verification

- All 96 configured management link definitions (including shift notes, excluding disabled delivery) map to exactly one workspace section.
- Repository test runner includes query-aware sidebar navigation regression tests.
- Repository verification passed: doctor, initial 991 repository tests, TypeScript, production build, runtime budget. Final tests including navigation regressions: 994 passed.
- Permission and archived-notification architecture checks passed. Semantic lint: zero errors (existing page warnings); full formatting lint still reports legacy formatting errors in the touched source files.
- No signed-in browser smoke is claimed. Visual acceptance with real role sessions remains necessary before merging.

## Reversal

Revert the navigation commit; no database rollback is required.

## Short labels and requested preview

Navigation groups and sections now use short Arabic labels, generally one word. Page links retain two or three words where needed to distinguish customer/employee points, invoice review, monthly evaluation, and quarterly incentives. Existing pages remain separate. The customer-followup heading is aligned with the shorter navigation label.

The user authorized a Vercel test deployment after this branch was prepared. Production remains a separate release decision. The repository's preview isolation gate requires a staging Supabase project and rejects the production project; do not weaken this gate or create a paid/new database to work around it.
