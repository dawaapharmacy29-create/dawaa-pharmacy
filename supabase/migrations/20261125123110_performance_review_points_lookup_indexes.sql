SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS idx_employee_transactions_source_id_status_v1 ON public.employee_transactions (source_id) INCLUDE (status);
CREATE INDEX IF NOT EXISTS idx_conversation_sales_reviews_pending_impact_v1 ON public.conversation_sales_reviews (id) WHERE impact_status='pending';
