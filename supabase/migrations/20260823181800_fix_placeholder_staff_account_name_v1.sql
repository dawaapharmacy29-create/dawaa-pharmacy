update public.staff_accounts sa
set staff_name = s.name,
    updated_at = now()
from public.staff s
where sa.username = 'د مي'
  and sa.active = true
  and coalesce(sa.can_login, true) = true
  and sa.staff_id = s.id::text
  and lower(coalesce(trim(sa.staff_name),'')) in ('غير محدد','غير معروف','unknown','undefined','null','user');
