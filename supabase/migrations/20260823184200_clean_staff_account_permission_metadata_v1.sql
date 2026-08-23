update public.staff_accounts
set permissions = coalesce(permissions,'{}'::jsonb) - array['role','branch','staff_name','staff_id','scope']::text[]
where coalesce(permissions,'{}'::jsonb) ?| array['role','branch','staff_name','staff_id','scope'];
