-- Security hotfix: the v1 doctor-points summary is an internal projection until
-- canonical staff/branch scoped access is implemented.
--
-- The application currently uses a custom staff-account identity layer over the
-- Supabase anon role. A regular owner-security view must therefore never be
-- exposed directly to anon/public, because doing so can bypass underlying RLS
-- and reveal cross-branch staff/request performance data.

revoke all on table public.customer_request_doctor_points_summary_v1
  from public, anon, authenticated;

grant select on table public.customer_request_doctor_points_summary_v1
  to service_role;

comment on view public.customer_request_doctor_points_summary_v1 is
  'Internal customer-request doctor-points projection. Direct client SELECT is intentionally disabled until a canonical current-staff/branch-scoped read model replaces this v1 view.';
