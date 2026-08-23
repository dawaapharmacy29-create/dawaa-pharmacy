update public.user_profiles up
set staff_account_id = sa.id,
    updated_at = now()
from public.staff_accounts sa
where up.staff_account_id is null
  and up.id = sa.id
  and coalesce(up.active,true) = true
  and coalesce(sa.active,false) = true
  and coalesce(sa.can_login,false) = true;
