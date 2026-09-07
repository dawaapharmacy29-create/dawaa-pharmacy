-- Fix conversation review fingerprint generation in Supabase environments where
-- pgcrypto is installed in the `extensions` schema rather than on search_path.
-- Keep the same canonical fingerprint contract; only qualify the digest function.

create or replace function public.set_conversation_review_submission_fingerprint_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_staff_key text;
  v_reviewer_key text;
  v_customer_key text;
  v_payload text;
begin
  if new.conversation_date is null then
    new.submission_fingerprint := null;
    return new;
  end if;

  v_staff_key := coalesce(
    new.staff_id::text,
    nullif(lower(trim(coalesce(new.staff_name, ''))), ''),
    '__no_staff__'
  );
  v_reviewer_key := coalesce(
    new.reviewer_id::text,
    nullif(lower(trim(coalesce(new.reviewer_name, ''))), ''),
    '__no_reviewer__'
  );
  v_customer_key := coalesce(
    nullif(trim(coalesce(new.customer_code, '')), ''),
    nullif(trim(coalesce(new.customer_id, '')), ''),
    nullif(lower(trim(coalesce(new.customer_name, ''))), ''),
    '__no_customer__'
  );

  v_payload := concat_ws(
    '|',
    v_staff_key,
    v_reviewer_key,
    to_char(new.conversation_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    v_customer_key
  );

  new.submission_fingerprint := encode(
    extensions.digest(convert_to(v_payload, 'UTF8'), 'sha256'::text),
    'hex'
  );
  return new;
end;
$$;

revoke all on function public.set_conversation_review_submission_fingerprint_v2()
  from public, anon, authenticated;
