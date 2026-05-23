-- مقترح فقط — راجع وأنشئ Migration يدويًا في Supabase.
-- لا يتم تشغيل هذا الملف تلقائيًا من التطبيق.

-- ═══════════════ نقاط وتقييم ═══════════════

create table if not exists public.evaluation_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  category text not null,
  title text not null,
  description text,
  default_points numeric not null default 0,
  type text not null check (type in ('deduction', 'bonus')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  role_scope text not null default 'all',
  requires_approval boolean not null default false,
  evidence_required boolean not null default false,
  allowed_approver_roles text[] default '{}',
  repeat_policy text not null default 'none',
  max_points_cap numeric,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.points_transactions
  add column if not exists employee_id uuid,
  add column if not exists rule_code text,
  add column if not exists base_points numeric,
  add column if not exists repeat_count integer default 0,
  add column if not exists multiplier numeric default 1,
  add column if not exists final_points numeric,
  add column if not exists applied_by_role text,
  add column if not exists approved_by_role text,
  add column if not exists approved_by uuid,
  add column if not exists approver_required_role text,
  add column if not exists operation_kind text,
  add column if not exists manager_note text,
  add column if not exists created_by text,
  add column if not exists source_module text,
  add column if not exists source_record_id uuid;

alter table if exists public.point_records
  add column if not exists status text default 'approved',
  add column if not exists rule_code text,
  add column if not exists applied_by_role text,
  add column if not exists approved_by_role text;

-- ═══════════════ تقييم محادثات موسّع ═══════════════

create table if not exists public.conversation_sales_reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid,
  reviewer_name text,
  reviewer_role text,
  staff_id uuid,
  staff_name text,
  staff_role text,
  branch text,
  customer_id text,
  customer_name text,
  customer_code text,
  customer_phone text,
  evaluation_kind text,
  invoice_number text,
  evaluation_reason text,
  total_score numeric,
  raw_scores jsonb,
  has_complaint boolean default false,
  has_medical_error boolean default false,
  has_invoice_error boolean default false,
  reviewer_notes text,
  training_recommendation text,
  final_score numeric,
  point_impact numeric,
  impact_status text default 'approved',
  reviewed_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ═══════════════ تقييم دليفري ═══════════════

create table if not exists public.delivery_evaluations (
  id uuid primary key default gen_random_uuid(),
  delivery_staff_name text not null,
  branch text,
  eval_date date not null default current_date,
  issue_type text not null,
  severity text not null,
  suggested_points numeric not null default 0,
  notes text,
  recorded_by_name text,
  recorded_by_role text,
  status text not null default 'pending',
  created_at timestamptz default now()
);

create index if not exists delivery_eval_staff_date_idx on public.delivery_evaluations (delivery_staff_name, eval_date desc);

-- ═══════════════ سجل نشاط موسّع ═══════════════

alter table if exists public.activity_log
  add column if not exists user_role text,
  add column if not exists target_type text,
  add column if not exists target_id text,
  add column if not exists branch_id uuid;

create index if not exists activity_log_created_idx on public.activity_log (created_at desc);

-- ملاحظة: إن كان الجدول اسمه activity_logs في مشروعك، طبّق نفس الأعمدة هناك أو وحّد الاسم.

-- --- إضافة اختيارية لجدول الإذونات والإجازات (نطاق تاريخ) ---
-- alter table public.shift_exceptions add column if not exists date_end date;
-- alter table public.shift_exceptions add column if not exists end_date date;

-- --- تتبع انخفاض متوسط الشراء بين الشهور (للتنبيهات المستقبلية) ---
-- alter table public.customer_analysis add column if not exists avg_monthly_prev numeric;
