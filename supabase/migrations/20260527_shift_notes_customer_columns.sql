-- Required by the improved Shift Notes customer linking and completion flow.
alter table public.shift_notes
add column if not exists customer_id uuid null references public.customers(id) on delete set null,
add column if not exists customer_code text null,
add column if not exists whatsapp_phone text null,
add column if not exists whatsapp_link text null,
add column if not exists completed_by_name text null,
add column if not exists completed_at timestamp with time zone null,
add column if not exists cancelled_by_name text null,
add column if not exists cancelled_at timestamp with time zone null,
add column if not exists deleted_at timestamp with time zone null,
add column if not exists deleted_by_id uuid null,
add column if not exists deleted_by_name text null;

create index if not exists idx_shift_notes_customer_id on public.shift_notes(customer_id);
create index if not exists idx_shift_notes_customer_code on public.shift_notes(customer_code);
create index if not exists idx_shift_notes_completed_at on public.shift_notes(completed_at);
create index if not exists idx_shift_notes_deleted_at on public.shift_notes(deleted_at);

notify pgrst, 'reload schema';
