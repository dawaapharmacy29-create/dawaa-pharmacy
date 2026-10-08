# Verified staff session identity — rollout runbook

Scope: `20261008115000_base44_purchase_sync_service_actor_v1.sql`, `20261008120000_verified_staff_session_identity_v1.sql`, the client change on branch `performance-shadow-v1-20261004`, and the `base44-purchase-invoice-sync` Edge Function.
Every step below needs explicit owner approval. Nothing here has been applied.

## Order (each step is safe on its own)

| # | Step | Safe because | Verify | Undo |
|---|------|--------------|--------|------|
| 0 | Freeze parallel DB work for ~30 min; note `select md5(pg_get_functiondef('public.import_base44_purchase_invoices_v1(jsonb)'::regprocedure))` = `db806d8561edf5d05600a0efac4e5ea4` | — | md5 matches | — |
| 1 | Preview from the branch SHA, log in as GM, branch manager, pharmacist | Client sends both headers; old DB still reads `x-dawaa-user-id` | Browser devtools: requests carry `x-dawaa-session-token`, no CORS error on preflight; `refresh_staff_login_session_v1` returns `true` | Close Preview |
| 2 | Apply `20261008115000` | anon + header path unchanged until step 3 | Next 15-min `base44_sync_run_log` row = `success` | `supabase/sql/ROLLBACK_20261008_base44_purchase_sync_service_actor_v1.sql` |
| 3 | Deploy `supabase/functions/base44-purchase-invoice-sync` | Uses service_role; works with step 2 | Next run `success`; `edge_logs` show the import RPC with a service key | Redeploy previous version (v3) |
| 4 | Promote the client to Production | Same as step 1 | Users stay signed in (sessions < 12h) or re-login once | Redeploy previous Vercel build |
| 5 | Wait ≥ 30 min (every open tab re-checks its session within 30 min or on reload; expired ones re-login once) | Old sessions were never refreshed before this client | `select count(*) from staff_login_sessions where revoked_at is null and expires_at > now() and last_used_at > now() - interval '1 hour'` ≈ active users | — |
| 6 | Apply `20261008120000` | Snapshot of 59 functions taken first | Run `supabase/sql/TEST_20261008_verified_staff_session_identity_v1.sql` inside `begin … rollback`; smoke: GM/branch manager/pharmacist dashboards, Doctor Eye, customer-service queues, payroll statement, review points | `supabase/sql/ROLLBACK_20261008_verified_staff_session_identity_v1.sql` (md5-verified restore) |

## Watch for 24h after step 6

- `edge_logs`: spike of `401/403` or PostgREST `42501` from browsers.
- `base44_sync_run_log`: every run `success`.
- Users reporting forced logout more than once (would mean refresh failing).

## Not covered by this rollout (separate fixes)

- `notification-web-push-v1` Edge Function still trusts `x-dawaa-user-id` at the edge (not used by the current client).
- `dawaawael-verify-staff` falls back to plaintext `password_pin`/`password`.
- One-off Edge Functions without caller authentication (`one-time-*-sales-import-*`, `product-demand-v22-one`) should be disabled.
