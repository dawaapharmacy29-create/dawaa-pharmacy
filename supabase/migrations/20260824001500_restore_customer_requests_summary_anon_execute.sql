-- The admin app uses the project's custom staff-account auth layer over the Supabase anon role.
-- Keep this read-only aggregate RPC executable by anon, matching the rest of the custom-auth RPC surface.
grant execute on function public.get_customer_requests_command_center_summary(text)
  to anon, authenticated, service_role;
