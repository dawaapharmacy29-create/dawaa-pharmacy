-- Harden the active review and shift-note tables without changing business data.

-- conversation_sales_reviews is the canonical table used by Reviews.tsx.
drop policy if exists "conversation_sales_reviews_admin_all" on public.conversation_sales_reviews;
drop policy if exists "Allow anon insert conversation sales reviews" on public.conversation_sales_reviews;
drop policy if exists "conversation_sales_reviews_auth_insert" on public.conversation_sales_reviews;
drop policy if exists "conversation_sales_reviews_insert_all" on public.conversation_sales_reviews;
drop policy if exists "Allow anon read conversation sales reviews" on public.conversation_sales_reviews;
drop policy if exists "conversation_sales_reviews_auth_select" on public.conversation_sales_reviews;
drop policy if exists "conversation_sales_reviews_select_all" on public.conversation_sales_reviews;
drop policy if exists "Allow anon update conversation sales reviews" on public.conversation_sales_reviews;
drop policy if exists "conversation_sales_reviews_auth_update" on public.conversation_sales_reviews;
drop policy if exists "conversation_sales_reviews_update_all" on public.conversation_sales_reviews;

create policy conversation_sales_reviews_select_canonical
on public.conversation_sales_reviews
for select
to anon, authenticated
using (
  public.dawaa_current_actor_can(array['view_reviews'])
);

create policy conversation_sales_reviews_insert_canonical
on public.conversation_sales_reviews
for insert
to anon, authenticated
with check (
  public.dawaa_current_actor_can(array['add_reviews'])
);

create policy conversation_sales_reviews_update_canonical
on public.conversation_sales_reviews
for update
to anon, authenticated
using (
  public.dawaa_current_actor_can(array['edit_reviews','approve_reviews'])
)
with check (
  public.dawaa_current_actor_can(array['edit_reviews','approve_reviews'])
);

-- Shift notes do not yet have a dedicated canonical action permission. Until the
-- UI/permission contract adds one, require a real active staff account for every
-- read/write instead of allowing unauthenticated public writes.
do $$
declare
  t text;
begin
  foreach t in array array['shift_notes','shift_note_logs','shift_note_occurrences']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_insert_app', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_app', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_app', t);

    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (public.dawaa_current_staff_account_id_strict() is not null)',
      t || '_select_active_actor', t
    );
    execute format(
      'create policy %I on public.%I for insert to anon, authenticated with check (public.dawaa_current_staff_account_id_strict() is not null)',
      t || '_insert_active_actor', t
    );
    execute format(
      'create policy %I on public.%I for update to anon, authenticated using (public.dawaa_current_staff_account_id_strict() is not null) with check (public.dawaa_current_staff_account_id_strict() is not null)',
      t || '_update_active_actor', t
    );
  end loop;
end $$;
