-- READ ONLY. Run fresh before a separately approved apply; any unexpected result ABORTS it.
BEGIN READ ONLY;
SELECT version(),current_user,current_database();
SELECT p.proname,pg_get_function_identity_arguments(p.oid) signature,md5(p.prosrc) body_md5,
 pg_get_userbyid(p.proowner) owner,p.proacl,p.proconfig,p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('sales_intelligence_reconcile_case_set_v1','sales_intelligence_write_case_analysis','dawaa_archive_superseded_whatsapp_source_v35','sales_intelligence_reconcile_case_set_v2','sales_intelligence_stage_case_analysis_v1');
DO $$ BEGIN
 IF current_user <> 'postgres' OR current_setting('server_version_num')::int / 10000 <> 17 THEN RAISE EXCEPTION 'role/version drift'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.sales_intelligence_reconcile_case_set_v1(uuid,text[])'::regprocedure) IS DISTINCT FROM '9fd2f5976e2419ca7154d203b29da5fc'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.sales_intelligence_write_case_analysis(text,jsonb)'::regprocedure) IS DISTINCT FROM 'c6c53c94a20cfdbf2946371398790d98'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.dawaa_archive_superseded_whatsapp_source_v35(text,timestamptz,timestamptz,integer,uuid[])'::regprocedure) IS DISTINCT FROM 'fd7b5e40f631e4633049147cb2933ee7' THEN RAISE EXCEPTION 'function baseline drift'; END IF;
 IF (SELECT md5(string_agg(format('%s.%s:%s:%s:%s',table_name,column_name,data_type,is_nullable,coalesce(column_default,'')),'|' ORDER BY table_name,ordinal_position)) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('sales_intelligence_cases','sales_intelligence_case_analyses','whatsapp_review_sources','whatsapp_customer_cases_v22','conversation_sales_reviews')) IS DISTINCT FROM 'c02af025fa7e858a524df12520b30a9f' THEN RAISE EXCEPTION 'table schema drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('sales_intelligence_reconcile_case_set_v2','sales_intelligence_stage_case_analysis_v1','sales_intelligence_on_source_archived_v1')) THEN RAISE EXCEPTION 'candidate function already exists; use verified reapply procedure'; END IF;
 IF (SELECT md5(string_agg(pg_get_triggerdef(t.oid),'|' ORDER BY t.tgname)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('sales_intelligence_cases','sales_intelligence_case_analyses','whatsapp_review_sources')) IS DISTINCT FROM '5a6e20613b8ce3074082d5709bf4e9c1' THEN RAISE EXCEPTION 'trigger drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('public.sales_intelligence_reconcile_case_set_v1(uuid,text[])'::regprocedure,'public.sales_intelligence_write_case_analysis(text,jsonb)'::regprocedure) AND (NOT prosecdef OR pg_get_userbyid(proowner)<>'postgres' OR proacl::text <> '{postgres=X/postgres,service_role=X/postgres}')) THEN RAISE EXCEPTION 'owner/security/ACL drift'; END IF;
 IF EXISTS(SELECT case_id FROM public.sales_intelligence_case_analyses WHERE is_current GROUP BY case_id HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate current analyses'; END IF;
 IF (SELECT count(*) FROM public.sales_intelligence_cases c WHERE c.is_active AND NOT EXISTS(SELECT 1 FROM public.sales_intelligence_current_case_analyses a WHERE a.case_id=c.case_id)) <> 53 THEN RAISE EXCEPTION 'missing-current cohort drift'; END IF;
 IF (SELECT count(*) FROM public.sales_intelligence_cases c JOIN public.whatsapp_review_sources s ON s.id=c.conversation_id WHERE c.is_active AND s.review_status='archived') <> 39 THEN RAISE EXCEPTION 'archived cohort drift'; END IF;
 IF (SELECT count(*) FROM public.sales_intelligence_cases c JOIN public.sales_intelligence_case_analyses a ON a.analysis_id=c.published_analysis_id WHERE a.superseded_at IS NOT NULL) <> 16 THEN RAISE EXCEPTION 'published-superseded baseline drift'; END IF;
END $$;
SELECT pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('sales_intelligence_cases','sales_intelligence_case_analyses','whatsapp_review_sources');
-- Must match baseline/catalog.json: only trg_whatsapp_invoice_evidence_v17; never replace it.
SELECT 'cases' kind,count(*) rows,md5(coalesce(string_agg(to_jsonb(c)::text,'|' ORDER BY case_id),'')) fingerprint FROM public.sales_intelligence_cases c
UNION ALL SELECT 'analyses',count(*),md5(coalesce(string_agg(to_jsonb(a)::text,'|' ORDER BY analysis_id),'')) FROM public.sales_intelligence_case_analyses a;
SELECT count(*) pointer_mismatches FROM public.sales_intelligence_cases c WHERE c.published_analysis_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_intelligence_case_analyses a WHERE a.analysis_id=c.published_analysis_id AND a.case_id=c.case_id AND a.is_current AND a.superseded_at IS NULL);
-- Expected mismatch baseline: 16. Save both fingerprints/counts externally for postcheck.
COMMIT;
