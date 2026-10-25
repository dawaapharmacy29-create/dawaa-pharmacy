-- Read-only catalog observations from dawaa-pharmacy-os, 2026-10-25.
-- LOCAL synthetic fixture only: production's legacy permissive policies/default trigger.
drop policy staff_identity_aliases_select_active_actor on public.staff_identity_aliases;
drop policy staff_identity_aliases_manage_staff_accounts on public.staff_identity_aliases;
grant all on public.staff_identity_aliases to anon, authenticated;
create policy staff_identity_aliases_anon_select on public.staff_identity_aliases for select to anon using (true);
create policy staff_identity_aliases_auth_select on public.staff_identity_aliases for select to authenticated using (true);
create policy staff_identity_aliases_auth_insert on public.staff_identity_aliases for insert to authenticated with check (true);
create policy staff_identity_aliases_auth_update on public.staff_identity_aliases for update to authenticated using (true) with check (true);
-- is_app_admin's internal dependencies are outside this fixture; no test caller is an app admin.
create policy staff_identity_aliases_admin_all on public.staff_identity_aliases for all to authenticated using (false) with check (false);
create unique index uq_staff_identity_aliases_staff_alias on public.staff_identity_aliases(staff_id,alias_name)
where staff_id is not null and alias_name is not null;
create index staff_identity_aliases_normalized_active_idx on public.staff_identity_aliases(normalized_alias,active);
create index idx_staff_identity_aliases_staff on public.staff_identity_aliases(staff_id);
create index idx_staff_identity_aliases_alias on public.staff_identity_aliases(alias_name);
create index idx_staff_identity_aliases_norm on public.staff_identity_aliases(normalized_alias);

create function public.dawaa_normalize_staff_alias(p_text text) returns text
language plpgsql immutable as $$
declare v text;
begin
  v := lower(coalesce(p_text, ''));
  v := replace(v, 'الدكتور', '');
  v := replace(v, 'الدكتورة', '');
  v := replace(v, 'دكتور', '');
  v := replace(v, 'دكتورة', '');
  v := replace(v, 'د/', '');
  v := replace(v, 'د /', '');
  v := replace(v, 'د.', '');
  v := replace(v, 'د ', '');
  v := replace(v, 'ا/', '');
  v := replace(v, 'أ/', '');
  v := replace(v, 'ـ', '');
  v := regexp_replace(v, '[[:space:]]+', '', 'g');
  v := regexp_replace(v, '[^\\u0600-\\u06FFa-z0-9]+', '', 'g');
  return nullif(v, '');
end $$;
create function public.staff_identity_aliases_fill_defaults() returns trigger language plpgsql as $$
begin
  if new.normalized_alias is null or new.normalized_alias = '' or new.normalized_alias = 'alias' then
    new.normalized_alias := coalesce(public.dawaa_normalize_staff_alias(new.alias_name),new.alias_name,'alias');
  end if;
  new.source := coalesce(new.source,'manual');
  new.priority := coalesce(new.priority,1);
  new.active := coalesce(new.active,true);
  new.created_at := coalesce(new.created_at,now());
  new.updated_at := coalesce(new.updated_at,now());
  return new;
end $$;
create trigger trg_staff_identity_aliases_fill_defaults before insert or update
on public.staff_identity_aliases for each row execute function public.staff_identity_aliases_fill_defaults();
