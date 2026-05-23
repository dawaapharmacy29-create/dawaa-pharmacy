-- Run this after the main staff_accounts migration if old usernames/branch names were inserted.
-- It keeps the accounts and updates their usernames/branches without deleting history.

update public.staff_accounts
set username = 'doha', branch = 'فرع الشامي', updated_at = now()
where username = 'doha.shamy';

update public.staff_accounts
set username = 'shimaa', branch = 'فرع الشامي', updated_at = now()
where username = 'shimaa.shamy';

update public.staff_accounts
set username = 'aliyaa', branch = 'فرع الشامي', updated_at = now()
where username = 'aliyaa.shamy';

update public.staff_accounts
set username = 'yousef', branch = 'فرع الشامي', updated_at = now()
where username = 'yousef.shamy';

update public.staff_accounts
set username = 'sara', branch = 'فرع شكري', updated_at = now()
where username = 'sara.abo';

update public.staff_accounts
set username = 'ola', branch = 'فرع شكري', updated_at = now()
where username = 'ola.abo';

update public.staff_accounts
set username = 'donia', branch = 'فرع شكري', updated_at = now()
where username = 'donia.abo';

update public.staff_accounts
set username = 'islam', branch = 'فرع شكري', updated_at = now()
where username = 'islam.abo';

update public.staff_accounts
set username = 'hassan', branch = 'فرع شكري', updated_at = now()
where username = 'hassan.abo';

update public.staff_accounts
set username = 'mohamed.khaled.shokry', branch = 'فرع شكري', updated_at = now()
where username = 'mohamed.khaled.abo';

update public.staff_accounts
set branch = 'فرع شكري', updated_at = now()
where username = 'mohamed.shehata';

update public.staff_accounts
set username = 'mostafa', branch = 'فرع الشامي', updated_at = now()
where username = 'mostafa.shamy';

update public.staff_accounts
set branch = 'فرع الشامي', updated_at = now()
where username in ('mohamed.khaled.shamy', 'mohamed.mesad', 'ahmed.batal');

update public.staff_accounts
set branch = 'فرع شكري', updated_at = now()
where username = 'ahmed.wagih';

update public.staff_accounts
set username = 'eslam', branch = 'فرع شكري', updated_at = now()
where username = 'eslam.delivery';

update public.staff_accounts
set username = 'hussein', branch = 'فرع شكري', updated_at = now()
where username = 'hussein.delivery';

update public.staff_accounts
set branch = 'فرع شكري', updated_at = now()
where branch in ('فرع أبو العزم', 'فرع ابو العزم', 'أبو العزم', 'ابو العزم');

select username, name, role, branch, active
from public.staff_accounts
order by branch, role, name;
