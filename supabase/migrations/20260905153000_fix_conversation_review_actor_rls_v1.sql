-- Keep conversation review writes aligned with the custom staff-account session model.
-- Accept both current and legacy review-create permission keys and tolerate legacy
-- sessions whose reviewer_id still contains staff_id instead of staff_accounts.id.

drop policy if exists conversation_sales_reviews_insert_canonical on public.conversation_sales_reviews;
create policy conversation_sales_reviews_insert_canonical
on public.conversation_sales_reviews
for insert
to public
with check (
  public.dawaa_current_actor_can(array['add_reviews','reviews.action.create'])
  and (
    reviewer_id = public.dawaa_current_staff_account_id_strict()
    or exists (
      select 1
      from public.staff_accounts sa
      where sa.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(sa.active,false)
        and coalesce(sa.can_login,false)
        and reviewer_id::text = sa.staff_id::text
    )
    or public.dawaa_actor_is_top_management_v1()
  )
);

drop policy if exists conversation_sales_reviews_update_canonical on public.conversation_sales_reviews;
create policy conversation_sales_reviews_update_canonical
on public.conversation_sales_reviews
for update
to public
using (
  public.dawaa_current_actor_can(array['edit_reviews','approve_reviews'])
)
with check (
  public.dawaa_current_actor_can(array['edit_reviews','approve_reviews'])
  and (
    reviewer_id = public.dawaa_current_staff_account_id_strict()
    or exists (
      select 1
      from public.staff_accounts sa
      where sa.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(sa.active,false)
        and coalesce(sa.can_login,false)
        and reviewer_id::text = sa.staff_id::text
    )
    or public.dawaa_actor_is_top_management_v1()
  )
);
