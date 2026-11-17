-- DawaaBills moved from Base44 to Lovable on 14/11/2026. The accountant sync now reads the book from
-- https://dawaabill.lovable.app/api/public/accountant-export with this key (vault secret
-- «dawaabills_export_key»; the same value is the ACCOUNTANT_EXPORT_KEY secret in Lovable).
-- Readable by the service role only, like get_base44_api_key_v1.

create or replace function public.get_dawaabills_export_key_v1()
returns text
language sql
security definer
set search_path to 'public', 'vault'
as $function$
  select decrypted_secret from vault.decrypted_secrets where name = 'dawaabills_export_key' limit 1;
$function$;

revoke all on function public.get_dawaabills_export_key_v1() from public, anon, authenticated;
grant execute on function public.get_dawaabills_export_key_v1() to service_role;
