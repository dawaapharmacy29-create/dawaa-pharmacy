-- Customer Service Script Library V3 guard
-- Production quick_reply_scripts was normalized before this migration was added.
-- This guard fails deployment if duplicate active shortcuts are reintroduced.

do $$
begin
  if exists (
    select 1
    from public.quick_reply_scripts
    where active = true
    group by lower(shortcut)
    having count(*) > 1
  ) then
    raise exception 'Customer service script library has duplicate active shortcuts';
  end if;
end $$;
