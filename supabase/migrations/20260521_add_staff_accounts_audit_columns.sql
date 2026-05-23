-- Add audit columns to staff_accounts table
-- This migration ensures created_by and updated_by columns exist

alter table public.staff_accounts add column if not exists created_by uuid;
alter table public.staff_accounts add column if not exists updated_by uuid;

-- Add comments for documentation
comment on column public.staff_accounts.created_by is 'UUID of the user who created this staff account';
comment on column public.staff_accounts.updated_by is 'UUID of the user who last updated this staff account';
