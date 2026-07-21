update public.staff_accounts
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object(
  'view_dashboard', true,
  'view_branch_dashboard', true,
  'view_dashboard_stats', true,
  'view_analytics', false,
  'view_analytics_sales', false,
  'view_sales_reports', false,
  'export_sales_reports', false,
  'view_invoices', false,
  'view_invoice_import', false,
  'customer_welcome_messages.view', false,
  'customer_welcome_messages.create', false,
  'customer_welcome_messages.update', false,
  'view_penalty_management', true,
  'manage_penalty_management', false,
  'dashboard.scope.branch_only', true,
  'points.scope.branch_only', true,
  'penalties_rewards.scope.branch_only', true,
  'sales.section.branch_ranking', true
)
where active is true and role = 'branch_manager';

update public.staff_accounts
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object(
  'view_inventory', true,
  'view_operations', true,
  'view_supplies', true,
  'manage_inventory', true,
  'page.inventory.view', true,
  'page.shelf_organization.view', true,
  'page.supplies_checkpoint.view', true,
  'page.accessories_checkpoint.view', true,
  'page.branch_cleaning.view', case when lower(coalesce(username,'')) in ('habiba','heba.cleaning') then true else coalesce((permissions->>'page.branch_cleaning.view')::boolean,false) end,
  'checkpoint.action.review_shortages', true,
  'checkpoint.action.follow_orders', true,
  'checkpoint.action.inventory_count', true,
  'data_scope_branch_only', true
)
where active is true and role = 'assistant';

update public.staff_accounts
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object(
  'view_operations', true,
  'page.branch_cleaning.view', true,
  'branch_cleaning.section.tasks', true,
  'branch_cleaning.action.complete', true,
  'branch_cleaning.section.daily_evidence', true,
  'branch_cleaning.action.upload_daily_images', true,
  'data_scope_branch_only', true
)
where active is true and role = 'cleaning_supervisor';

update public.staff_accounts
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object(
  'customer_welcome_messages.view', true,
  'customer_welcome_messages.create', true,
  'customer_welcome_messages.update', true,
  'customer_service.section.whatsapp_templates', true
)
where active is true and lower(username) in ('dr.doha','dr.shimaa');

update public.staff_accounts
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object(
  'customer_welcome_messages.view', false,
  'customer_welcome_messages.create', false,
  'customer_welcome_messages.update', false,
  'customer_service.section.whatsapp_templates', false
)
where active is true and lower(username) not in ('dr.doha','dr.shimaa');

update public.staff_accounts
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object(
  'view_reviews', true,
  'add_reviews', false,
  'edit_reviews', false,
  'approve_reviews', false,
  'delete_reviews', false,
  'manage_conversation_evaluations', false,
  'reviews.scope.own_and_assigned', true
)
where active is true and lower(username) = 'dr_nada';

update public.staff_accounts
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object(
  'view_dashboard', true,
  'view_dashboard_stats', true,
  'view_branch_dashboard', true,
  'dashboard.scope.branch_only', true
)
where active is true and lower(username) = 'dr.donia';
