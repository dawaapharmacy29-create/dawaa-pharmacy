# Staff role export query

Run this query in Supabase SQL Editor and export the result as CSV:

```sql
select
  coalesce(display_name, name, username) as staff_name,
  username,
  role,
  branch,
  case
    when role in ('مدير عام','أدمن','admin','general_manager') then 'كل النظام وكل الفروع'
    when role in ('مدير فرع','branch_manager') then 'داشبورد الفرع، الفريق، الجدول، العملاء، التوصيل، النقاط، التقييمات'
    when role in ('مدير خدمة العملاء','customer_service_manager') then 'خدمة العملاء، المتابعات، CRM، الكاشباك، تقييمات المحادثات'
    when role in ('صيدلاني','صيدلي','دكتور','pharmacist') then 'صفحته الشخصية، العملاء، متابعة العميل، تقييم محادثة، الأدوية الراكدة والحوافز'
    when role in ('خدمة عملاء','موظف خدمة عملاء','customer_service') then 'العملاء، المتابعات، واتساب، CRM، حضانة العملاء، تقييم محادثة'
    when role in ('توصيل','دليفري','مندوب توصيل','delivery','rider') then 'التوصيل فقط'
    when role in ('مساعد مخزون','inventory_assistant') then 'المخزون، النواقص، الأدوية، الصلاحية'
    else 'داشبورد مبسط فقط'
  end as visible_pages,
  case when coalesce(active, true) and coalesce(can_login, true) then 'active' else 'disabled' end as account_status
from staff_accounts
order by branch, role, staff_name;
```
