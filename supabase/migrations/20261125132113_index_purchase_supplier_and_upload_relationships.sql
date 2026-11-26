SET LOCAL lock_timeout='2s';
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier_id_v1 ON public.purchase_invoices (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_review_invoices_upload_id_v1 ON public.purchase_review_invoices (upload_id);
