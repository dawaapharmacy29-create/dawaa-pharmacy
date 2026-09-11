# Notification Architecture V3

## Goal

The admin application has one notification architecture. Pages, the header bell, the operations center, background producers, SLA escalation, and deep links must not invent their own notification semantics.

## Boundaries

1. **Producer boundary**
   - New application writes go through `create_notification_audience_v1` / `emit_system_notification_v2`.
   - Historical `create_staff_notification` producers are compatibility wrappers that delegate into the same system boundary.
   - Direct application inserts into `public.notifications` are forbidden.

2. **Canonical read boundary**
   - `notification_events_v2_base` preserves the original enriched/SLA read model.
   - `notification_events_v2` is the compatibility read surface used by the current app. It applies V3 lifecycle, route, archive, and admin-scope invariants.
   - `notification_events_v3` exposes explicit semantic fields (`canonical_type`, `lifecycle_state`, `unread`, `open_action`, `app_scope`, `event_key`) for new consumers and audits.

3. **Admin / delivery isolation**
   - Admin notification read models never expose `delivery_order`, raw `delivery`, or `/delivery...` notification routes.
   - Delivery remains a separate application/workflow.

4. **Lifecycle invariant**
   - Terminal states are `completed` and `dismissed`.
   - Terminal notifications are always effectively read and never require an open action.
   - SLA-generated escalation rows are references to the source notification and do not create an independent workflow.
   - Read status and workflow status are not interchangeable: reading acknowledges visibility; workflow state records operational progress.

5. **Attention policy**
   - Per-customer VIP/follow-up alerts are operational actions.
   - Daily digest/report notifications are informational unless explicitly marked action-required.
   - Informational unread rows older than the attention window may expire from the unread counter while remaining in history.

6. **Deterministic routing**
   - Routing is normalized by `notification_route_v3`.
   - Conversation reviews always open the exact review.
   - VIP customer alerts always open the exact customer code.
   - SLA escalation opens the source notification in Operations Center.
   - Missing/legacy routes fail safely into Operations Center rather than doing nothing.

7. **Duplicate policy**
   - No notification history is deleted merely for duplication.
   - Only exact burst duplicates (same semantic target/audience/title in the same minute) are archived.
   - Recurring daily/weekly notifications remain distinct events.

8. **UI layering**
   - The layout/header notification layer is above normal page modals.
   - Consumers should never implement independent notification route or lifecycle logic.

## Health contracts

`notification_integrity_health_v3()` must report:
- `delivery_total = 0`
- `terminal_unread_invalid = 0`
- `terminal_open_action_invalid = 0`
- `healthy = true`

`notification_route_health_v3()` must report:
- `missing_route = 0`
- `delivery_route_leaks = 0`
- `review_route_mismatch = 0`
- `vip_route_mismatch = 0`
- `healthy = true`

A production change to notifications is not considered complete until these health contracts pass.

## Ownership

- Domain/type/group/lifecycle labels: `src/lib/notifications/notificationDomain.ts`
- Metadata contract: `src/lib/notifications/notificationMetadata.ts`
- App read/create service: `src/lib/notificationService.ts`
- Runtime/cache/navigation: `src/hooks/useNotifications.ts`
- Workflow transitions: `src/lib/notifications/notificationWorkflowService.ts`
- Header consumer: `src/components/layout/Header.tsx`
- Operations workflow UI: `src/pages/OperationsCenter2027.tsx`
- Database guardrails: `supabase/migrations/20260911063000_notification_architecture_v3_guardrails.sql`
