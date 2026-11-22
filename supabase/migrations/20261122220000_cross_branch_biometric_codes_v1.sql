-- Owner decision 2026-11-22: employees whose code was linked on one branch's fingerprint device only. Their code
-- is now linked on the other branch's device too (same code, same employee), so a punch there counts as soon as
-- their finger is enrolled on that device. د/ معاذ's code on the Shokry device was also marked out of scope, which
-- made the insert trigger drop his punches there silently; it is put back in scope.
with pairs(name, code, provider) as (
  values
    ('محمد عمر',      '317', 'zk_shokry_direct_bridge'),
    ('ادهم قاسم',     '287', 'zk_shokry_direct_bridge'),
    ('نور',           '290', 'zk_shokry_direct_bridge'),
    ('د/ مغازي',      '305', 'zk_shokry_direct_bridge'),
    ('د بسمله',       '324', 'zk_shokry_direct_bridge'),
    ('محمود القطري',  '316', 'zk_shokry_direct_bridge'),
    ('احمد رمضان ابراهيم', '321', 'zk_shokry_direct_bridge'),
    ('د/ معاذ',       '166', 'zk_shokry_direct_bridge'),
    ('احمد صلاح',     '319', 'zk_shami_direct_bridge'),
    ('حبيبة تامر',    '310', 'zk_shami_direct_bridge'),
    ('حسين',          '274', 'zk_shami_direct_bridge'),
    ('د دنيا',        '215', 'zk_shami_direct_bridge'),
    ('محمد حجازي',    '323', 'zk_shami_direct_bridge'),
    ('محمد شماتة',    '183', 'zk_shami_direct_bridge')
),
checked as (
  -- only where the code belongs to that employee on the other device and is free on this one
  select p.*, st.id as staff_id
  from pairs p
  join public.staff st on btrim(st.name) = p.name and st.is_active is true
  where public.dr_wael_cross_branch_owner_v1(p.provider, p.code) = st.id
    and not exists (select 1 from public.biometric_staff_mapping m
                    where m.provider = p.provider and m.biometric_user_id = p.code and m.active)
)
insert into public.biometric_employee_scope (provider, biometric_user_id, source_branch, canonical_branch, in_scope, source_note, updated_at)
select c.provider, c.code,
       case when c.provider = 'zk_shokry_direct_bridge' then 'فرع شكري' else 'فرع الشامي' end,
       st.branch, true, 'ربط إداري مؤكد 22/11: ' || c.name || ' — نفس الكود على جهاز الفرع التاني', now()
from checked c join public.staff st on st.id = c.staff_id
on conflict (provider, biometric_user_id) do update
  set in_scope = true, canonical_branch = excluded.canonical_branch, source_note = excluded.source_note, updated_at = now();

select p.name, p.code, p.provider, public.dr_wael_map_cross_branch_code_internal_v1(p.provider, p.code) as mapped_staff
from (values
    ('محمد عمر', '317', 'zk_shokry_direct_bridge'), ('ادهم قاسم', '287', 'zk_shokry_direct_bridge'),
    ('نور', '290', 'zk_shokry_direct_bridge'), ('د/ مغازي', '305', 'zk_shokry_direct_bridge'),
    ('د بسمله', '324', 'zk_shokry_direct_bridge'), ('محمود القطري', '316', 'zk_shokry_direct_bridge'),
    ('احمد رمضان ابراهيم', '321', 'zk_shokry_direct_bridge'), ('د/ معاذ', '166', 'zk_shokry_direct_bridge'),
    ('احمد صلاح', '319', 'zk_shami_direct_bridge'), ('حبيبة تامر', '310', 'zk_shami_direct_bridge'),
    ('حسين', '274', 'zk_shami_direct_bridge'), ('د دنيا', '215', 'zk_shami_direct_bridge'),
    ('محمد حجازي', '323', 'zk_shami_direct_bridge'), ('محمد شماتة', '183', 'zk_shami_direct_bridge')
  ) p(name, code, provider);
