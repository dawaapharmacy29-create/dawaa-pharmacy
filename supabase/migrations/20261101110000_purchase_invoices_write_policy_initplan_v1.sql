-- purchase_invoices_write is FOR ALL, so it is also OR-ed into every read: its functions ran on every
-- row (the evaluation lab still waited ~16 s on one cycle of purchase invoices after the select policy
-- was wrapped). Wrapped in sub-selects, each runs once per query. Same conditions for read and write.

alter policy purchase_invoices_write on public.purchase_invoices
  using (
    (select public.dawaa_actor_is_top_management_v1())
    or (select public.dawaa_current_actor_can(array['manage_purchases'::text]))
    or entered_by_staff_id = (select public.dawaa_current_staff_subject_uuid_v1())
  )
  with check (
    (select public.dawaa_actor_is_top_management_v1())
    or (select public.dawaa_current_actor_can(array['manage_purchases'::text]))
    or entered_by_staff_id = (select public.dawaa_current_staff_subject_uuid_v1())
  );
