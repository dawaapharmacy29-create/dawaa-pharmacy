-- Operations foundation repairs for pages reported as empty/broken:
-- employee daily tasks, activity log, hourly time-off fields, and staff-account visibility.

CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  user_name text,
  user_role text,
  operation text,
  action text,
  module text,
  entity_type text,
  entity_id text,
  entity_title text,
  details jsonb,
  branch text,
  branch_name text,
  branch_id text,
  target_type text,
  target_id text,
  old_value jsonb,
  new_value jsonb,
  route_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON public.activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_module ON public.activity_log (module);
CREATE INDEX IF NOT EXISTS idx_activity_log_branch ON public.activity_log (branch);

CREATE TABLE IF NOT EXISTS public.employee_daily_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id text,
  staff_name text,
  role text,
  branch text,
  task_key text NOT NULL,
  task_title text NOT NULL,
  task_description text,
  task_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'normal',
  source text NOT NULL DEFAULT 'system',
  related_route text,
  related_entity_type text,
  related_entity_id text,
  completed_at timestamptz,
  completed_by text,
  completed_by_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_daily_tasks_staff_day_key
ON public.employee_daily_tasks (coalesce(staff_id, staff_name, ''), task_date, task_key);
CREATE INDEX IF NOT EXISTS idx_employee_daily_tasks_day_branch ON public.employee_daily_tasks (task_date, branch);
CREATE INDEX IF NOT EXISTS idx_employee_daily_tasks_status ON public.employee_daily_tasks (status);

CREATE OR REPLACE FUNCTION public.complete_employee_daily_task(
  p_task_id uuid,
  p_notes text DEFAULT NULL,
  p_completed_by text DEFAULT NULL,
  p_completed_by_name text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.employee_daily_tasks
  SET status = 'completed',
      completed_at = now(),
      completed_by = p_completed_by,
      completed_by_name = p_completed_by_name,
      notes = coalesce(p_notes, notes),
      updated_at = now()
  WHERE id = p_task_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_employee_daily_tasks(
  p_staff_id text,
  p_staff_name text,
  p_role text,
  p_branch text,
  p_task_date date DEFAULT current_date
) RETURNS SETOF public.employee_daily_tasks
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile text := coalesce(nullif(p_role, ''), 'assistant');
BEGIN
  INSERT INTO public.employee_daily_tasks (
    staff_id, staff_name, role, branch, task_key, task_title, task_description,
    task_date, status, priority, source, related_route, related_entity_type, related_entity_id
  )
  VALUES
    (p_staff_id, p_staff_name, v_profile, p_branch, 'open_daily_workspace', 'فتح مساحة العمل اليومية', 'مراجعة مهام اليوم والأولويات قبل بداية الشيفت.', p_task_date, 'pending', 'high', 'system', '/employee-operating-system', 'role_profile', v_profile),
    (p_staff_id, p_staff_name, v_profile, p_branch, 'review_customer_or_shift_notes', 'مراجعة الملاحظات المطلوبة', 'مراجعة ملاحظات الشيفت أو العملاء حسب الدور والفرع.', p_task_date, 'pending', 'high', 'system', '/shift-notes', 'role_profile', v_profile),
    (p_staff_id, p_staff_name, v_profile, p_branch, 'end_shift_update', 'تحديث نهاية الشيفت', 'تسجيل ما تم أو ما يحتاج متابعة قبل انتهاء الشيفت.', p_task_date, 'pending', 'normal', 'system', '/employee-operating-system', 'role_profile', v_profile)
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  SELECT * FROM public.employee_daily_tasks
  WHERE coalesce(staff_id, staff_name, '') = coalesce(p_staff_id, p_staff_name, '')
    AND task_date = p_task_date
  ORDER BY priority DESC, created_at DESC;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.shift_exceptions') IS NOT NULL THEN
    ALTER TABLE public.shift_exceptions ADD COLUMN IF NOT EXISTS start_time text;
    ALTER TABLE public.shift_exceptions ADD COLUMN IF NOT EXISTS end_time text;
    ALTER TABLE public.shift_exceptions ADD COLUMN IF NOT EXISTS duration_hours numeric;
    ALTER TABLE public.shift_exceptions ADD COLUMN IF NOT EXISTS duration_minutes integer;
    ALTER TABLE public.shift_exceptions ADD COLUMN IF NOT EXISTS employee_name text;
    ALTER TABLE public.shift_exceptions ADD COLUMN IF NOT EXISTS source text;
    ALTER TABLE public.shift_exceptions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.staff_accounts') IS NOT NULL THEN
    ALTER TABLE public.staff_accounts ADD COLUMN IF NOT EXISTS visible_in_admin boolean DEFAULT true;
    ALTER TABLE public.staff_accounts ADD COLUMN IF NOT EXISTS can_login boolean DEFAULT true;
    ALTER TABLE public.staff_accounts ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;
