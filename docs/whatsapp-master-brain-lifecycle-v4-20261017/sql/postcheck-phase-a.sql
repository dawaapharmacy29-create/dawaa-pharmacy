-- READ ONLY immediately after Phase A SQL, BEFORE runtime activation or historical repair.
-- psql required variables: expected_cases, expected_analyses (fresh precheck fingerprints).
BEGIN READ ONLY;
SELECT version(),current_user;
SELECT 'sales_intelligence_stage_case_analysis_v1' function_name,md5(prosrc) body_md5,md5(prosrc)='b06dc86dd488b7af4418f53195252947' body_matches,pg_get_userbyid(proowner) owner,prosecdef,proconfig,proacl FROM pg_proc WHERE oid='public.sales_intelligence_stage_case_analysis_v1(text,jsonb)'::regprocedure;
SELECT 'sales_intelligence_reconcile_case_set_v2' function_name,md5(prosrc) body_md5,md5(prosrc)='97e621afd88048b1c1f8f04dfa70892a' body_matches,pg_get_userbyid(proowner) owner,prosecdef,proconfig,proacl FROM pg_proc WHERE oid='public.sales_intelligence_reconcile_case_set_v2(uuid,text[],jsonb)'::regprocedure;
SELECT 'sales_intelligence_on_source_archived_v1' function_name,md5(prosrc) body_md5,md5(prosrc)='cabbabec53cd0330fdb29f6669f2f4d1' body_matches,pg_get_userbyid(proowner) owner,prosecdef,proconfig,proacl FROM pg_proc WHERE oid='public.sales_intelligence_on_source_archived_v1()'::regprocedure;
SELECT 'dawaa_archive_superseded_whatsapp_source_v35' function_name,md5(prosrc) body_md5,md5(prosrc)='5209146fa7e69c228de39ca7cfc0c9e9' body_matches,pg_get_userbyid(proowner) owner,prosecdef,proconfig,proacl FROM pg_proc WHERE oid='public.dawaa_archive_superseded_whatsapp_source_v35(text,timestamptz,timestamptz,integer,uuid[])'::regprocedure;
SELECT md5(coalesce(string_agg(to_jsonb(c)::text,'|' ORDER BY case_id),'')) = :'expected_cases' AS no_case_changes FROM public.sales_intelligence_cases c;
SELECT md5(coalesce(string_agg(to_jsonb(a)::text,'|' ORDER BY analysis_id),'')) = :'expected_analyses' AS no_analysis_or_history_changes FROM public.sales_intelligence_case_analyses a;
SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('sales_intelligence_cases','sales_intelligence_case_analyses','whatsapp_review_sources');
-- Existing invoice evidence trigger must remain; exactly one additional source archive trigger.
SELECT case_id,count(*) FROM public.sales_intelligence_case_analyses WHERE is_current GROUP BY case_id HAVING count(*)>1;
SELECT case_id,count(*) FROM public.sales_intelligence_cases GROUP BY case_id HAVING count(*)>1;
-- Both duplicate result sets must be EMPTY. Existing 39/14 and 16 pointer mismatches are
-- deliberately not repaired by Phase A: fingerprints must be unchanged, not silently zeroed.
COMMIT;
