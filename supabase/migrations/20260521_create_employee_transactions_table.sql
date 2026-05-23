-- Create employee_transactions table for penalties and rewards
-- This table will be the single source of truth for all employee transactions

create table if not exists public.employee_transactions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  type text not null check (type in ('penalty', 'reward')),
  amount numeric(10, 2) default 0,
  points_delta integer default 0,
  reason text not null,
  description text,
  source text, -- e.g., 'conversation_evaluation', 'manual', 'system'
  source_id uuid, -- reference to source record (e.g., evaluation_id)
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  month_cycle text, -- e.g., '2024-05'
  branch text,
  status text default 'active' check (status in ('active', 'cancelled', 'pending'))
);

-- Create indexes for performance
create index if not exists employee_transactions_staff_id_idx on public.employee_transactions(staff_id);
create index if not exists employee_transactions_type_idx on public.employee_transactions(type);
create index if not exists employee_transactions_month_cycle_idx on public.employee_transactions(month_cycle);
create index if not exists employee_transactions_source_idx on public.employee_transactions(source, source_id);

-- Add comments
comment on table public.employee_transactions is 'Table for tracking all employee penalties and rewards';
comment on column public.employee_transactions.staff_id is 'Reference to the staff member';
comment on column public.employee_transactions.type is 'Type of transaction: penalty or reward';
comment on column public.employee_transactions.amount is 'Monetary amount (if applicable)';
comment on column public.employee_transactions.points_delta is 'Points added or deducted';
comment on column public.employee_transactions.source is 'Source of the transaction (e.g., conversation_evaluation, manual)';
comment on column public.employee_transactions.source_id is 'ID of the source record';

-- Enable RLS
alter table public.employee_transactions enable row level security;

-- Create RLS policies
create policy "employee_transactions_select_authenticated" 
on public.employee_transactions for select to authenticated using (true);

create policy "employee_transactions_insert_authenticated" 
on public.employee_transactions for insert to authenticated with check (true);

create policy "employee_transactions_update_authenticated" 
on public.employee_transactions for update to authenticated with check (true);

create policy "employee_transactions_delete_authenticated" 
on public.employee_transactions for delete to authenticated with check (true);

-- Grant permissions
grant select, insert, update, delete on public.employee_transactions to anon, authenticated;
