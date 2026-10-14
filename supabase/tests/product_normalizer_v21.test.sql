do $test$
declare
  v_function record;
begin
  select l.lanname, p.prorettype::regtype::text as return_type, p.provolatile,
         p.prosecdef, p.proargtypes::oidvector::text as argument_types
    into strict v_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.proname = 'dawaa_normalize_product_match_v21';

  if v_function.argument_types <> '25'
     or v_function.return_type <> 'text'
     or v_function.lanname <> 'sql'
     or v_function.provolatile <> 'i'
     or v_function.prosecdef then
    raise exception 'product normalizer function contract mismatch';
  end if;

  if public.dawaa_normalize_product_match_v21('Bone Care') <> 'bonecare'
     or public.dawaa_normalize_product_match_v21('  BONE-CARE  ') <> 'bonecare'
     or public.dawaa_normalize_product_match_v21('أكتيف')
       <> public.dawaa_normalize_product_match_v21('اكتيف')
     or public.dawaa_normalize_product_match_v21('إكس')
       <> public.dawaa_normalize_product_match_v21('اكس')
     or public.dawaa_normalize_product_match_v21('آلفا')
       <> public.dawaa_normalize_product_match_v21('الفا')
     or public.dawaa_normalize_product_match_v21('رحمة') <> 'رحمه'
     or public.dawaa_normalize_product_match_v21(null) <> ''
     or public.dawaa_normalize_product_match_v21('') <> '' then
    raise exception 'product normalizer output parity mismatch';
  end if;
end
$test$;
