-- The app calls RPCs as anon and resolves the staff account from its session
-- (dawaa_current_staff_account_id_strict); purchase_review_actor_v1 inside each function still allows
-- only general_manager / executive_manager / admin. Same pattern as get_accountant_report_v1.
grant execute on function public.get_purchase_review_v1(date) to anon;
grant execute on function public.import_purchase_review_file_v1(text, text, text, numeric, jsonb) to anon;
grant execute on function public.list_purchase_review_invoices_v1(date, date, text, text) to anon;
grant execute on function public.save_purchase_supplier_terms_v1(text, integer, integer, boolean, text) to anon;
grant execute on function public.add_purchase_review_payment_v1(text, text, numeric, date, text) to anon;
grant execute on function public.delete_purchase_review_payment_v1(uuid) to anon;
grant execute on function public.save_purchase_review_track_from_v1(date) to anon;
grant execute on function public.set_purchase_invoice_excluded_v1(text, text, boolean, text) to anon;
grant execute on function public.link_purchase_treasury_item_v1(text, text, boolean) to anon;
grant execute on function public.search_purchase_review_invoices_v1(text) to anon;
