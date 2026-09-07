-- Actionable diagnostics for integration sync streams.
-- This complements integration_sync_health_v1 with evidence that helps distinguish
-- agent outages, stalled watermarks, ingestion stalls and mapping problems.

create or replace function public.integration_sync_diagnostics_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_actor_id uuid;
  v_now timestamptz := now();
  v_health jsonb;
  v_bio_client_last timestamptz;
  v_bio_watermark timestamptz;
  v_bio_ingested_last timestamptz;
  v_bio_punch_last timestamptz;
  v_bio_unmapped integer := 0;
  v_bio_total integer := 0;
  v_bio_diagnosis text;
  v_bio_action text;
  v_purchase_last_run timestamptz;
  v_purchase_last_status text;
  v_purchase_last_error text;
  v_customer_pending integer := 0;
  v_customer_failed integer := 0;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not exists (
    select 1 from public.staff_accounts sa
    where sa.id=v_actor_id
      and coalesce(sa.active,false)=true
      and coalesce(sa.can_login,false)=true
  ) then
    raise exception using errcode='42501', message='active staff actor required';
  end if;

  v_health := public.integration_sync_health_v1();

  select max(last_seen_at)
    into v_bio_client_last
  from public.biometric_api_clients
  where active=true;

  select max(complete_through)
    into v_bio_watermark
  from public.biometric_sync_watermarks
  where provider='fingerprint_vendor_primary';

  select max(ingested_at), max(punch_time), count(*)::int,
         count(*) filter (where staff_id is null)::int
    into v_bio_ingested_last, v_bio_punch_last, v_bio_total, v_bio_unmapped
  from public.biometric_attendance_logs
  where provider='fingerprint_vendor_primary';

  if v_bio_client_last is null then
    v_bio_diagnosis := 'agent_never_connected';
    v_bio_action := 'تأكد من تشغيل Windows Fingerprint Agent على الجهاز الرئيسي وصحة مفتاح الاتصال.';
  elsif v_now - v_bio_client_last > interval '20 minutes' then
    v_bio_diagnosis := 'agent_offline';
    v_bio_action := 'برنامج البصمة لا يرسل heartbeat. راجع الجهاز الرئيسي والإنترنت وتشغيل الـAgent.';
  elsif v_bio_watermark is null then
    v_bio_diagnosis := 'watermark_missing';
    v_bio_action := 'الـAgent متصل لكن لا يوجد Watermark. راجع خطوة التحديث بعد إرسال الدفعة.';
  elsif v_now - v_bio_watermark > interval '30 minutes'
        and v_bio_ingested_last is not null
        and v_now - v_bio_ingested_last <= interval '20 minutes' then
    v_bio_diagnosis := 'watermark_stalled';
    v_bio_action := 'البصمات تصل لكن الـWatermark لا يتحرك. راجع ACK/complete_through في الـAgent.';
  elsif v_bio_ingested_last is null or v_now - v_bio_ingested_last > interval '30 minutes' then
    v_bio_diagnosis := 'ingestion_stalled';
    v_bio_action := 'الـAgent متصل لكن لا تصل سجلات بصمة حديثة. راجع قراءة قاعدة بيانات جهاز البصمة والرفع.';
  elsif v_bio_total > 0 and (v_bio_unmapped::numeric / v_bio_total::numeric) > 0.20 then
    v_bio_diagnosis := 'mapping_attention';
    v_bio_action := 'المصدر يعمل لكن نسبة البصمات غير المربوطة مرتفعة. راجع ربط أكواد البصمة بالموظفين.';
  else
    v_bio_diagnosis := 'healthy';
    v_bio_action := 'لا يوجد إجراء مطلوب لمسار البصمة الآن.';
  end if;

  select ran_at,status,error_message
    into v_purchase_last_run,v_purchase_last_status,v_purchase_last_error
  from public.base44_sync_run_log
  order by ran_at desc
  limit 1;

  select
    count(*) filter(where processing_status in ('received','pending','processing'))::int,
    count(*) filter(where processing_status in ('conflict','rejected','failed'))::int
    into v_customer_pending,v_customer_failed
  from public.customer_request_sync_inbox
  where source_system='dawaawael' and source_entity='CustomerOrder';

  return jsonb_build_object(
    'generated_at',v_now,
    'health',v_health,
    'biometrics',jsonb_build_object(
      'diagnosis',v_bio_diagnosis,
      'action',v_bio_action,
      'agent_last_seen_at',v_bio_client_last,
      'agent_age_minutes',case when v_bio_client_last is null then null else round(extract(epoch from(v_now-v_bio_client_last))/60.0,1) end,
      'watermark_complete_through',v_bio_watermark,
      'watermark_age_minutes',case when v_bio_watermark is null then null else round(extract(epoch from(v_now-v_bio_watermark))/60.0,1) end,
      'last_ingested_at',v_bio_ingested_last,
      'ingestion_age_minutes',case when v_bio_ingested_last is null then null else round(extract(epoch from(v_now-v_bio_ingested_last))/60.0,1) end,
      'last_punch_time',v_bio_punch_last,
      'total_events',v_bio_total,
      'unmapped_events',v_bio_unmapped,
      'mapping_rate',case when v_bio_total=0 then 0 else round(((v_bio_total-v_bio_unmapped)::numeric/v_bio_total::numeric)*100,1) end
    ),
    'purchase_invoices',jsonb_build_object(
      'last_reconcile_at',v_purchase_last_run,
      'last_run_status',v_purchase_last_status,
      'last_run_error',v_purchase_last_error
    ),
    'customer_orders',jsonb_build_object(
      'pending',v_customer_pending,
      'failed',v_customer_failed,
      'diagnosis',case when v_customer_failed>0 then 'failed_events' when v_customer_pending>0 then 'backlog' else 'healthy_or_idle' end
    )
  );
end;
$$;

revoke all on function public.integration_sync_diagnostics_v1() from public;
grant execute on function public.integration_sync_diagnostics_v1() to authenticated,service_role;

notify pgrst,'reload schema';
