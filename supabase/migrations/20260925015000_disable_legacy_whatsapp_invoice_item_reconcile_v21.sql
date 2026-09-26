-- The legacy V21 trigger promoted WhatsApp opportunities from statistical invoice matching
-- whenever invoice items were inserted. Sales Intelligence now uses canonical invoice-item
-- evidence directly, so this trigger must stay disabled to avoid conflicting/invalid stage writes.

drop trigger if exists trg_sales_invoice_item_reconcile_whatsapp_v21
on public.sales_invoice_items_v21;
