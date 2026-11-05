-- Shokry invoices since 2026-10-29 carry the seller «د دنيا الخولي», a spelling with no alias, so
-- 190 of Dr Donia's invoices had no staff_id (her sales, and the branch's seller coverage, dropped
-- below the evaluation minimum). Nine invoices with this spelling were already linked to her.
insert into public.staff_identity_aliases (staff_id, alias_name, normalized_alias, source, confidence, active, created_by)
select '0afe27ce-bc26-4b14-9e1b-c37d9040631e'::uuid, 'د دنيا الخولي', public.dawaa_normalize_staff_alias('د دنيا الخولي'), 'manual', 1, true, 'migration:20261105181000'
where not exists (
  select 1 from public.staff_identity_aliases
  where active and normalized_alias = public.dawaa_normalize_staff_alias('د دنيا الخولي')
);

select public.dawaa_backfill_invoice_staff_links_v1('2026-10-26'::date, null);
