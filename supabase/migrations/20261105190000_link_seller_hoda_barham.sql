-- «د هدي برهام» (31 invoices in both branches since 2026-10-29) had no alias, so no staff_id.
-- Linked to «د هدي» (Shamy) by the owner's decision on 2026-11-05.
insert into public.staff_identity_aliases (staff_id, alias_name, normalized_alias, source, confidence, active, created_by)
select 'd40cb3d7-9548-46eb-b001-2754ab692e97'::uuid, 'د هدي برهام', public.dawaa_normalize_staff_alias('د هدي برهام'), 'manual', 1, true, 'migration:20261105190000'
where not exists (
  select 1 from public.staff_identity_aliases
  where active and normalized_alias = public.dawaa_normalize_staff_alias('د هدي برهام')
);

select public.dawaa_backfill_invoice_staff_links_v1('2026-10-26'::date, null);
