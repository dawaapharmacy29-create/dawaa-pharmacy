update public.user_profiles up
set staff_account_id = sa.id,
    active = false,
    updated_at = now()
from public.staff_accounts sa
where up.staff_account_id is null
  and up.id = sa.id
  and up.auth_user_id is null
  and coalesce(up.active,true) = true
  and (coalesce(sa.active,false) = false or coalesce(sa.can_login,false) = false);
