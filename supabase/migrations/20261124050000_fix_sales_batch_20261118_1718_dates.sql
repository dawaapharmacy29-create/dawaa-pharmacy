-- Owner approval 2026-11-24: the upload batch chatgpt-20261118-1718 (278 invoices of 17-18/11, ~98.5K EGP) was saved
-- without sale_date, and 205 of them without save_status, so they were missing from sales, the evaluation, the list
-- incentive and the delivery matching. The date comes from invoice_date (Cairo); the empty save status is the saved
-- state (the same file marks its pending invoices 'معلقة'). The previous values are kept in a backup table.
create table if not exists public.backup_sales_batch_20261118_1718 as
select id, sale_date, save_status, import_validation_status from public.sales_invoices where import_batch='chatgpt-20261118-1718';

update public.sales_invoices
set sale_date = (invoice_date at time zone 'Africa/Cairo')::date,
    save_status = coalesce(save_status, 'تم حفظها')
where import_batch='chatgpt-20261118-1718' and sale_date is null and invoice_date is not null;
