create or replace function public.dawaa_guard_daily_followup_state_v2()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $function$
declare
  v_status text := lower(trim(coalesce(new.followup_status,new.status,'')));
  v_result text := nullif(trim(coalesce(new.followup_result,new.contact_result,'')),'');
  v_summary text := nullif(trim(coalesce(new.evaluation_summary,new.followup_summary,new.followup_notes,'')),'');
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_completed boolean := v_status in ('تم','مكتمل','completed','done');
  v_cancelled boolean := v_status in ('ملغي','ملغى','cancelled','canceled') or new.cancelled_at is not null;
  v_postponed boolean := v_status in ('مؤجل','postponed') or new.postponed_until is not null;
  v_old_status text;
  v_old_completed boolean := false;
  v_old_cancelled boolean := false;
  v_old_postponed boolean := false;
  v_enter_hidden boolean;
  v_validate_cancelled boolean;
  v_validate_postponed boolean;
  v_validate_completed boolean;
begin
  if current_setting('dawaa.historical_import',true)='on' then return new; end if;
  new.updated_at := now();

  if tg_op='UPDATE' then
    v_old_status := lower(trim(coalesce(old.followup_status,old.status,'')));
    v_old_completed := v_old_status in ('تم','مكتمل','completed','done') or old.completed_at is not null;
    v_old_cancelled := v_old_status in ('ملغي','ملغى','cancelled','canceled') or old.cancelled_at is not null;
    v_old_postponed := v_old_status in ('مؤجل','postponed') or old.postponed_until is not null;
  end if;

  v_enter_hidden := coalesce(new.is_hidden,false) and (
    tg_op='INSERT' or not coalesce(old.is_hidden,false)
    or new.hidden_reason is distinct from old.hidden_reason
    or new.archive_reason is distinct from old.archive_reason
  );

  v_validate_cancelled := v_cancelled and (
    tg_op='INSERT' or not v_old_cancelled
    or new.cancelled_reason is distinct from old.cancelled_reason
    or new.cancelled_at is distinct from old.cancelled_at
  );

  v_validate_postponed := v_postponed and not v_cancelled and not v_completed and (
    tg_op='INSERT' or not v_old_postponed
    or new.postponed_until is distinct from old.postponed_until
    or new.next_followup_date is distinct from old.next_followup_date
  );

  v_validate_completed := v_completed and not v_cancelled and (
    tg_op='INSERT' or not v_old_completed
    or new.completed_at is distinct from old.completed_at
    or new.followup_result is distinct from old.followup_result
    or new.contact_result is distinct from old.contact_result
    or new.followup_summary is distinct from old.followup_summary
    or new.evaluation_summary is distinct from old.evaluation_summary
    or new.followup_notes is distinct from old.followup_notes
  );

  if v_enter_hidden then
    if nullif(trim(coalesce(new.hidden_reason,new.archive_reason,'')),'') is null then
      raise exception 'سبب الأرشفة مطلوب قبل إخفاء المتابعة';
    end if;
    new.hidden_at := coalesce(new.hidden_at,new.archived_at,now());
    new.archived_at := coalesce(new.archived_at,new.hidden_at);
    new.hidden_reason := coalesce(nullif(trim(new.hidden_reason),''),nullif(trim(new.archive_reason),''));
    new.archive_reason := coalesce(nullif(trim(new.archive_reason),''),nullif(trim(new.hidden_reason),''));
  end if;

  if v_validate_cancelled then
    if nullif(trim(coalesce(new.cancelled_reason,new.followup_notes,'')),'') is null then
      raise exception 'سبب إلغاء المتابعة مطلوب';
    end if;
    new.cancelled_at := coalesce(new.cancelled_at,now());
    new.cancelled_reason := coalesce(nullif(trim(new.cancelled_reason),''),nullif(trim(new.followup_notes),''));
    new.status := 'ملغي';
    new.followup_status := 'ملغي';
  end if;

  if v_validate_postponed then
    if new.postponed_until is null and new.next_followup_date is null then
      raise exception 'حدد موعد التأجيل أو تاريخ المتابعة القادمة';
    end if;
    if new.postponed_until is not null and new.postponed_until<=now() then
      raise exception 'موعد التأجيل يجب أن يكون في المستقبل';
    end if;
    if new.next_followup_date is not null and new.next_followup_date<v_today then
      raise exception 'تاريخ المتابعة القادمة لا يمكن أن يكون في الماضي';
    end if;
    if new.postponed_until is not null then
      new.next_followup_date := (new.postponed_until at time zone 'Africa/Cairo')::date;
    end if;
    new.needs_next_followup := true;
    new.completed_at := null;
    new.status := 'مؤجل';
    new.followup_status := 'مؤجل';
  end if;

  if v_validate_completed then
    if v_result is null then raise exception 'نتيجة المتابعة مطلوبة قبل الإغلاق'; end if;
    if v_summary is null or length(v_summary)<10 then
      raise exception 'اكتب ملخصًا واضحًا للمتابعة لا يقل عن 10 أحرف قبل الإغلاق';
    end if;
    new.completed_at := coalesce(new.completed_at,now());
    new.evaluation_summary := coalesce(nullif(trim(new.evaluation_summary),''),v_summary);
    new.followup_summary := coalesce(nullif(trim(new.followup_summary),''),v_summary);
    new.status := 'تم';
    new.followup_status := 'تم';
  end if;

  return new;
end
$function$;

select pg_notify('pgrst','reload schema');