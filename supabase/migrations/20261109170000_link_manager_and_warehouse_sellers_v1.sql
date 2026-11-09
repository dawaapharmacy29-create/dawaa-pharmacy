-- Owner confirmed on 2026-11-09: «د معاذ» is the general manager; نور, هاجر, محمد عبد الرحمن and هبه are
-- warehouse staff selling from whichever branch the invoice carries. The invoice branch is unchanged.
insert into public.staff_identity_aliases (staff_id, alias_name, normalized_alias, source, confidence, active, created_by)
select v.staff_id, v.alias_name, public.dawaa_normalize_staff_alias_v1(v.alias_name), 'manual', 1, true, 'migration:20261109170000'
from (values
  ('303f15a8-5161-4c99-8301-4df256215a25'::uuid, 'د معاذ'),
  ('82b9c2a1-6139-4b07-9937-ef80a6e926d8'::uuid, 'نور'),
  ('e3640642-5c60-4815-8001-1bb93193668f'::uuid, 'هاجر'),
  ('74dffff0-ecdb-49b8-8e92-43b1ceca788c'::uuid, 'محمد عبد الرحمن'),
  ('dea91886-1ae8-4766-a166-9952866a5024'::uuid, 'هبه')
) as v(staff_id, alias_name)
where not exists (
  select 1 from public.staff_identity_aliases a
  where a.active and a.normalized_alias = public.dawaa_normalize_staff_alias_v1(v.alias_name)
);

select public.dawaa_backfill_invoice_staff_links_v1('2026-10-26'::date, null);
