-- Migration to create/update activity_logs table for comprehensive audit logging
-- Date: 2024-05-20

-- Create activity_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  entity_type text,
  entity_id uuid,
  entity_title text,
  user_id uuid,
  user_name text,
  user_role text,
  branch_id uuid,
  branch_name text,
  details text,
  old_value jsonb,
  new_value jsonb,
  route_path text,
  created_at timestamptz default now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS activity_logs_user_id_idx ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS activity_logs_branch_id_idx ON public.activity_logs(branch_id);
CREATE INDEX IF NOT EXISTS activity_logs_entity_type_id_idx ON public.activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS activity_logs_operation_idx ON public.activity_logs(operation);
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON public.activity_logs(created_at desc);

-- Add comments for documentation
COMMENT ON TABLE public.activity_logs IS 'Comprehensive audit log for all system operations';
COMMENT ON COLUMN public.activity_logs.operation IS 'Type of operation performed (e.g., create, update, delete, login, logout)';
COMMENT ON COLUMN public.activity_logs.entity_type IS 'Type of entity affected (e.g., stagnant_medicine, incentive_medicine, staff_account)';
COMMENT ON COLUMN public.activity_logs.entity_id IS 'ID of the affected entity';
COMMENT ON COLUMN public.activity_logs.entity_title IS 'Human-readable title of the affected entity';
COMMENT ON COLUMN public.activity_logs.user_id IS 'ID of the user who performed the operation';
COMMENT ON COLUMN public.activity_logs.user_name IS 'Name of the user who performed the operation';
COMMENT ON COLUMN public.activity_logs.user_role IS 'Role of the user who performed the operation';
COMMENT ON COLUMN public.activity_logs.branch_id IS 'ID of the branch where the operation occurred';
COMMENT ON COLUMN public.activity_logs.branch_name IS 'Name of the branch where the operation occurred';
COMMENT ON COLUMN public.activity_logs.details IS 'Additional details about the operation';
COMMENT ON COLUMN public.activity_logs.old_value IS 'Previous state of the entity (for update/delete operations)';
COMMENT ON COLUMN public.activity_logs.new_value IS 'New state of the entity (for create/update operations)';
COMMENT ON COLUMN public.activity_logs.route_path IS 'Route path where the operation occurred (e.g., /stagnant-medicines)';
