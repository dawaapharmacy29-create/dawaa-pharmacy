-- Customer Service Script Library V3 quality guard
-- Ensures every active script has a non-empty message and at least one response question/action.

do $$
begin
  if exists (
    select 1
    from public.quick_reply_scripts
    where active = true
      and (coalesce(btrim(message_body), '') = '' or questions is null or cardinality(questions) = 0)
  ) then
    raise exception 'Active customer service scripts must have a message and at least one response question/action';
  end if;
end $$;
