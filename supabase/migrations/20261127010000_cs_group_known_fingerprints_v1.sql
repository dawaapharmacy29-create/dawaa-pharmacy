-- فولدر تصدير الجروبات (صاحب الصيدلية 2026-11-26): الفولدر فيه محادثات الأيام اللي فاتت كمان، فقبل المراجعة بنسأل
-- أنهي رسايل اتسجلت قبل كده عشان نعرض ونرفع الجديد بس.
create or replace function public.dawaa_cs_group_known_v1(p_kind text, p_fingerprints text[])
returns text[]
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  a public.staff_accounts := public.dawaa_cs_group_actor_v1();
begin
  if p_kind = 'followups' then
    return coalesce((select array_agg(f.fingerprint) from public.cs_group_followups f
                     where f.fingerprint = any(p_fingerprints)), '{}');
  elsif p_kind = 'requests' then
    return coalesce((select array_agg(r.fingerprint) from public.customer_request_group_log_v1 r
                     where r.fingerprint = any(p_fingerprints)), '{}');
  end if;
  raise exception 'kind لازم يبقى followups أو requests';
end;
$function$;

revoke all on function public.dawaa_cs_group_known_v1(text, text[]) from public;
grant execute on function public.dawaa_cs_group_known_v1(text, text[]) to anon, authenticated;
