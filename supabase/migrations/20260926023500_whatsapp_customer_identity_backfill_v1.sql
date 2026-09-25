-- Step 2 customer identity repair.
-- Backfill only the ten known legacy WhatsApp sources whose export filename contains a unique,
-- verified pharmacy customer code. Existing source phone/name/branch evidence is preserved.

with mapping(source_id, customer_id) as (
  values
    ('f35c5632-991f-489e-98fa-f237cb592b87'::uuid, 'd8054eca-895a-40ba-94aa-8d3f0eb39833'::uuid), -- 17777 محمد الكموني
    ('73101c91-979e-420c-b7be-2eefd523093e'::uuid, '23c9c8ef-b844-49e5-9fd2-d2c9fa8d6e47'::uuid), -- 8183 مونزا
    ('cb60a81d-f084-40df-b08f-9fbf8e5fd517'::uuid, '23c9c8ef-b844-49e5-9fd2-d2c9fa8d6e47'::uuid),
    ('0c925c2d-8705-4b90-9bed-5fe11bac22c0'::uuid, 'a2fd0b6e-1562-438c-8f16-76a43539f792'::uuid), -- 3643 ابراهيم الصياد
    ('5280fc43-ddfc-4a82-9f00-ea1db1549b2b'::uuid, 'a2fd0b6e-1562-438c-8f16-76a43539f792'::uuid),
    ('89f4fdb1-dd77-4a80-a2ff-593dc9b4d73e'::uuid, 'a2fd0b6e-1562-438c-8f16-76a43539f792'::uuid),
    ('3a6d1591-4c94-421a-bc37-4d89d7b9afb1'::uuid, '31119545-c159-4d2f-9b9d-7549ae6c8343'::uuid), -- 4250 اليماني
    ('75fb82b5-9693-4edf-93b2-59bfbea6c76c'::uuid, '31119545-c159-4d2f-9b9d-7549ae6c8343'::uuid),
    ('7a4c1fb1-baec-4ab2-8630-71a4dcd9299f'::uuid, '31119545-c159-4d2f-9b9d-7549ae6c8343'::uuid),
    ('95fef156-0228-421b-9efa-3496518fc14d'::uuid, '31119545-c159-4d2f-9b9d-7549ae6c8343'::uuid)
),
resolved as (
  select
    m.source_id,
    c.id as customer_id,
    c.customer_code,
    coalesce(c.display_name,c.name,c.customer_name) as canonical_name,
    coalesce(c.normalized_phone,c.phone,c.customer_phone,c.whatsapp_phone,c.mobile,c.whatsapp,c.phone_alt) as canonical_phone,
    coalesce(c.effective_branch,c.branch) as canonical_branch
  from mapping m
  join public.customers c on c.id=m.customer_id
  where coalesce(c.is_duplicate,false)=false
)
update public.whatsapp_review_sources s
set
  customer_id = r.customer_id,
  customer_code = coalesce(s.customer_code, r.customer_code),
  customer_name = coalesce(s.customer_name, r.canonical_name),
  customer_phone = coalesce(s.customer_phone, r.canonical_phone),
  branch = coalesce(s.branch, r.canonical_branch),
  analysis_json = jsonb_set(
    coalesce(s.analysis_json,'{}'::jsonb),
    '{customerIdentity}',
    coalesce(s.analysis_json->'customerIdentity','{}'::jsonb) ||
      jsonb_build_object(
        'matchedBy','legacy_unique_file_code',
        'resolutionStatus','resolved',
        'resolutionReason','legacy_unique_file_code_backfill',
        'customerId',r.customer_id,
        'customerCode',coalesce(s.customer_code,r.customer_code),
        'customerPhone',coalesce(s.customer_phone,r.canonical_phone),
        'customerRegisteredBranch',r.canonical_branch
      ),
    true
  ),
  updated_at = now()
from resolved r
where s.id=r.source_id
  and s.customer_id is null;

do $$
declare
  remaining integer;
begin
  select count(*) into remaining
  from public.whatsapp_review_sources
  where id in (
    'f35c5632-991f-489e-98fa-f237cb592b87',
    '73101c91-979e-420c-b7be-2eefd523093e',
    'cb60a81d-f084-40df-b08f-9fbf8e5fd517',
    '0c925c2d-8705-4b90-9bed-5fe11bac22c0',
    '5280fc43-ddfc-4a82-9f00-ea1db1549b2b',
    '89f4fdb1-dd77-4a80-a2ff-593dc9b4d73e',
    '3a6d1591-4c94-421a-bc37-4d89d7b9afb1',
    '75fb82b5-9693-4edf-93b2-59bfbea6c76c',
    '7a4c1fb1-baec-4ab2-8630-71a4dcd9299f',
    '95fef156-0228-421b-9efa-3496518fc14d'
  )
  and customer_id is null;
  if remaining <> 0 then
    raise exception 'WhatsApp customer identity backfill incomplete: % rows still unlinked', remaining;
  end if;
end $$;
