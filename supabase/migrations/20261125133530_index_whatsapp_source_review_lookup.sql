SET LOCAL lock_timeout='2s';
CREATE INDEX IF NOT EXISTS idx_conversation_sales_reviews_whatsapp_source_v1 ON public.conversation_sales_reviews (whatsapp_review_source_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_review_sources_created_at_v1 ON public.whatsapp_review_sources (created_at DESC) INCLUDE (id);
