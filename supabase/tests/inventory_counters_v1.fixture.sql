-- Synthetic isolated fixture; reuses the weekly count fixture (no production IDs).
\ir branch_inventory_weekly_counts_v1.fixture.sql
insert into public.staff_accounts values
  ('00000000-0000-4000-8000-000000000006', 'مساعد غير مسؤول', 'assistant', 'فرع شكري', true, true),
  ('00000000-0000-4000-8000-000000000007', 'مسؤول كل الفروع', 'team_dawaa_alpha', 'المخزن', true, true),
  ('00000000-0000-4000-8000-000000000008', 'مسؤول من غير دخول', 'assistant', 'فرع الشامي', true, false);
