-- Confirmed by operations: both employees punch at the Shami terminal.
-- Create canonical HR identities only; logins, pay and schedules need their
-- own reviewed inputs. Numeric device codes are deliberately not auto-mapped.
do $$
declare v_name text;
begin
  foreach v_name in array array['دعاء ابراهيم','احمد السيد'] loop
    if (select count(*) from public.staff where trim(name)=v_name) > 1 then
      raise exception 'duplicate canonical staff name: %',v_name;
    end if;
  end loop;
end $$;

insert into public.staff(name,role,branch,active,is_active,status,type)
select v.name,v.role,'فرع الشامي',true,true,'نشط',v.staff_type
from (values
  ('دعاء ابراهيم'::text,'مساعد صيدلي'::text,'Pharmacist'::text),
  ('احمد السيد'::text,'توصيل'::text,'Delivery'::text)
) v(name,role,staff_type)
where not exists(select 1 from public.staff s where trim(s.name)=v.name);
