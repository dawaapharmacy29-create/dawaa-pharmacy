-- توحيد مفتاح منع التكرار بين تريجر قاعدة البيانات وإشعار الواجهة.
-- الهدف: تقييم محادثة واحد = إشعار واحد، مع بقاء تريجر DB كشبكة أمان.

create or replace function public.notify_doctor_on_conversation_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_staff_id uuid := new.staff_id;
  v_score numeric := 0;
  v_impact numeric := 0;
  v_reviewer text;
  v_action text := lower(tg_op);
  v_dedupe_key text;
begin
  if v_staff_id is null then
    v_staff_id := public.resolve_review_staff_id(v_row);
  end if;
  if v_staff_id is null then
    return new;
  end if;

  begin
    v_score := coalesce(
      nullif(v_row->>'final_score','')::numeric,
      nullif(v_row->>'total_score','')::numeric,
      nullif(v_row->>'score','')::numeric,
      0
    );
  exception when others then
    v_score := 0;
  end;

  begin
    v_impact := coalesce(
      nullif(v_row->>'doctor_points_impact','')::numeric,
      nullif(v_row->>'point_impact','')::numeric,
      0
    );
  exception when others then
    v_impact := 0;
  end;

  v_reviewer := coalesce(nullif(v_row->>'reviewer_name',''), 'مراجع خدمة العملاء');

  -- هذا هو نفس المفتاح النهائي الذي تنتجه createNotification في الواجهة:
  -- buildNotificationDedupeKey(...) ثم create_notification_audience_v1 يضيف staff_id في النهاية.
  v_dedupe_key := lower(format(
    'conversation_review:%s:conversation_review:%s:current:%s',
    v_staff_id::text,
    new.id::text,
    v_staff_id::text
  ));

  perform public.create_staff_notification(
    v_staff_id,
    'conversation_review',
    case
      when tg_op = 'INSERT' and v_score < 70 then 'تقييم محادثة يحتاج مراجعة'
      when tg_op = 'INSERT' then 'تم حفظ تقييم محادثة'
      else 'تم تعديل تقييم محادثتك'
    end,
    case
      when v_score < 70 then
        format('درجتك %s/100، وتأثير النقاط %s. راجع الملاحظات لتجنب تكرار الخطأ. التقييم بواسطة %s.', v_score, v_impact, v_reviewer)
      else
        format('تقييم المحادثة %s/100، وتأثير النقاط %s. التقييم بواسطة %s.', v_score, v_impact, v_reviewer)
    end,
    'conversation_review',
    new.id::text,
    '/doctor-dashboard?tab=reviews&reviewId=' || new.id::text,
    case when v_score < 70 then 'high' else 'normal' end,
    jsonb_build_object(
      'score', v_score,
      'points_impact', v_impact,
      'reviewer', v_reviewer,
      'action', v_action,
      'staff_name', new.staff_name,
      'branch', new.branch,
      'positive_note', coalesce(new.main_positive_reason, new.top_positive_reason),
      'improvement_note', coalesce(new.main_negative_reason, new.top_deduction_reason),
      'route', '/doctor-dashboard?tab=reviews&reviewId=' || new.id::text
    ),
    v_dedupe_key,
    null,
    new.branch
  );

  return new;
end;
$$;
