-- High-confidence seller aliases verified against active staff accounts and invoice branch context.
-- They only improve identity linkage; invoice values/branch/date remain unchanged.

INSERT INTO public.staff_identity_aliases
  (id, staff_id, alias_name, normalized_alias, source, confidence, active, created_at, created_by, updated_at, priority)
VALUES
  (gen_random_uuid(), '43c5a028-9fcc-419b-8453-2ae0b43a9707', 'د علياء سامي', public.dawaa_normalize_staff_alias('د علياء سامي'), 'doctor_sales_truth_v25', 1, true, now(), 'chatgpt_assisted', now(), 1),
  (gen_random_uuid(), '43c5a028-9fcc-419b-8453-2ae0b43a9707', 'علياء سامي', public.dawaa_normalize_staff_alias('علياء سامي'), 'doctor_sales_truth_v25', 1, true, now(), 'chatgpt_assisted', now(), 1),
  (gen_random_uuid(), '86ca8d4e-3186-4c8c-9ec3-6b6ea8d70395', 'د علا سامي', public.dawaa_normalize_staff_alias('د علا سامي'), 'doctor_sales_truth_v25', 1, true, now(), 'chatgpt_assisted', now(), 1),
  (gen_random_uuid(), '86ca8d4e-3186-4c8c-9ec3-6b6ea8d70395', 'علا سامي', public.dawaa_normalize_staff_alias('علا سامي'), 'doctor_sales_truth_v25', 1, true, now(), 'chatgpt_assisted', now(), 1)
ON CONFLICT DO NOTHING;
