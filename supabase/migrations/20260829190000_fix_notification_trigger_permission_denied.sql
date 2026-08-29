-- إصلاح: create_staff_notification() ماعندهاش EXECUTE للـ authenticated role
-- (بس لـ postgres/service_role). أي trigger function بيناديها من غير ما يكون
-- SECURITY DEFINER بيفشل بـ"permission denied for function
-- create_staff_notification" أول ما مستخدم عادي (authenticated) يعمل
-- INSERT/UPDATE مباشر على الجدول من غير المرور بـ RPC مرفوع الصلاحيات.
--
-- طُبّق هذا الإصلاح مباشرة على قاعدة الإنتاج بتاريخ 2026-08-29، بعد بلاغ
-- مباشر عن الخطأ فعليًا عند حفظ تقييم أسبوعي لمدير فرع (رسالة الخطأ:
-- "permission denied for function create_staff_notification"). لاحظنا نفس
-- النمط شغال صح في notify_doctor_on_conversation_review و
-- trg_coaching_note_notify (SECURITY DEFINER)، فطبّقنا نفس النمط على
-- الثلاثة اللي كانوا ناقصينها:
-- 1) trg_weekly_evaluation_notify — تقييم مدير الفرع/الفروع/خدمة العملاء
--    الأسبوعي (المشكلة اللي بلّغ عنها المستخدم فعليًا).
-- 2) trg_checklist_review_settlement — اعتماد/رفض بنود التشيك ليست اليومي
--    (النظافة، المساعد، وخدمة العملاء المُضافة حديثًا في هذه الجلسة).
-- 3) trg_monthly_narrative_evaluation_notify — إشعار اعتماد التقييم الشهري
--    للدكاترة والمساعدين.
-- هذا الملف يوثّق نفس التغيير في المستودع حسب
-- docs/ARCHITECTURE_TARGET.md البند 11.

create or replace function public.trg_weekly_evaluation_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if new.status = 'submitted' and (old.status is distinct from new.status or old is null) then
    perform public.create_staff_notification(
      new.subject_staff_id, 'weekly_evaluation_submitted',
      'تقييمك الأسبوعي جاهز — ' || coalesce(round(new.total_score), 0) || '/100',
      coalesce(new.evaluator_name, 'مدير الفروع') || ' قيّم أسبوعك بدرجة ' || coalesce(round(new.total_score), 0) || '/100.'
        || coalesce(' ملاحظة: ' || new.manual_note, ''),
      'manager_weekly_evaluations', new.id::text, '/weekly-evaluation/' || new.evaluation_type, 'high',
      jsonb_build_object('score', new.total_score, 'weekStart', new.week_start),
      'weekly-eval:' || new.id::text, new.evaluator_staff_id, new.branch
    );
  end if;
  return new;
end;
$function$;

create or replace function public.trg_checklist_review_settlement()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_item_title text;
  v_reviewer_name text;
begin
  if new.review_status in ('approved','rejected') and (old.review_status is distinct from new.review_status) then
    perform public.settle_checklist_review(new.id);

    select title into v_item_title from public.staff_daily_checklist_items where id = new.item_id;
    v_reviewer_name := coalesce(new.reviewed_by_name, 'مدير الفرع');

    if new.review_status = 'rejected' then
      perform public.create_staff_notification(
        new.staff_id, 'checklist_rejected',
        'مدير الفرع رفض بند: ' || coalesce(v_item_title, ''),
        coalesce(v_reviewer_name, 'مدير الفرع') || ' رفض بند "' || coalesce(v_item_title,'') || '" بتاريخ ' || new.submission_date
          || coalesce('. ملاحظة: ' || new.reviewer_note, '.') || ' اتسجل خصم تلقائي.',
        'staff_daily_checklist_submissions', new.id::text, '/my-daily-checklist', 'high',
        jsonb_build_object('itemId', new.item_id, 'submissionDate', new.submission_date),
        'checklist-rejected:' || new.id::text, new.reviewed_by, new.branch
      );
    elsif new.review_status = 'approved' then
      perform public.create_staff_notification(
        new.staff_id, 'checklist_approved',
        'اعتماد بند: ' || coalesce(v_item_title, ''),
        coalesce(v_reviewer_name, 'مدير الفرع') || ' اعتمد بند "' || coalesce(v_item_title,'') || '" بتاريخ ' || new.submission_date || '.',
        'staff_daily_checklist_submissions', new.id::text, '/my-daily-checklist', 'normal',
        jsonb_build_object('itemId', new.item_id, 'submissionDate', new.submission_date),
        'checklist-approved:' || new.id::text, new.reviewed_by, new.branch
      );
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.trg_monthly_narrative_evaluation_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if new.status in ('sent','approved') and (old.status is distinct from new.status) then
    perform public.create_staff_notification(
      new.staff_id, 'monthly_evaluation_ready',
      'تقييمك الشهري جاهز — ' || coalesce(new.grade, '') || ' (' || coalesce(round(new.overall_score),0) || '/100)',
      coalesce(new.manager_notes, 'راجع تقييمك الشهري وخطة الشهر الجاي.'),
      'staff_monthly_manager_evaluations', new.id::text, '/staff-monthly-evaluation', 'high',
      jsonb_build_object('score', new.overall_score, 'grade', new.grade, 'approvedIncentive', new.approved_incentive),
      'monthly-eval-notify:' || new.id::text, new.evaluator_id, new.branch
    );
  end if;
  return new;
end;
$function$;
