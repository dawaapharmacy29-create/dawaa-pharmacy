-- Recovery finished and was verified against the source workbook.
-- The SECURITY DEFINER helper must not remain executable after recovery.
revoke all on function public.recover_sales_rows_20260821(jsonb) from public, anon, authenticated;
drop function if exists public.recover_sales_rows_20260821(jsonb);
