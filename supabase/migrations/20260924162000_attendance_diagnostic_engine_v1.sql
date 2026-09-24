-- Attendance Diagnostic Engine V1
-- Deterministic diagnostic layer on top of Attendance Truth.
-- Does not mutate truth; explains why a case is pending and what action is recommended.

create or replace function public.attendance_case_diagnostic_v1(
  p_staff_id uuid,
  p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_row public.attendance_daily_summary%rowtype;
  v_staff public.staff%rowtype;
  v_snap jsonb;
  v_raw_count integer:=0;
  v_root text;
  v_title text;
  v_diagnosis text;
  v_blocker text;
  v_owner text;
  v_confidence integer:=85;
  v_auto_fix boolean:=false;
  v_actions jsonb:='[]'::jsonb;
  v_window_start timestamptz;
  v_window_end timestamptz;
begin
  if p_staff_id is null or p_date is null then
    raise exception 'attendance_diagnostic_identity_or_date_missing' using errcode='22023';
  end if;

  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'attendance_diagnostic_staff_not_found' using errcode='22023'; end if;

  if not public.dawaa_can_read_staff_attendance_log(p_staff_id,v_staff.branch) then
    raise exception 'not_authorized_for_attendance_diagnostic' using errcode='42501';
  end if;

  select * into v_row
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id and a.attendance_date=p_date
  order by a.updated_at desc
  limit 1;

  if not found then
    raise exception 'attendance_diagnostic_day_not_materialized' using errcode='22023';
  end if;

  v_snap:=coalesce(v_row.resolution_snapshot,'{}'::jsonb);

  if v_row.scheduled_start_at is not null and v_row.scheduled_end_at is not null then
    v_window_start:=v_row.scheduled_start_at-interval '4 hours';
    v_window_end:=v_row.scheduled_end_at+interval '6 hours';
  else
    v_window_start:=p_date::timestamp at time zone 'Africa/Cairo';
    v_window_end:=((p_date+1)::timestamp+interval '6 hours') at time zone 'Africa/Cairo';
  end if;

  select count(*)::int into v_raw_count
  from public.biometric_attendance_logs bl
  where bl.staff_id=p_staff_id
    and public.dawaa_fingerprint_effective_time_v1(bl.provider,bl.raw_payload,bl.punch_time)>=v_window_start
    and public.dawaa_fingerprint_effective_time_v1(bl.provider,bl.raw_payload,bl.punch_time)<v_window_end;

  case coalesce(v_row.resolution_status,'')
    when 'no_schedule' then
      v_root:='NO_SCHEDULE';
      v_title:='لا يوجد جدول معتمد لهذا اليوم';
      v_diagnosis:='لا يمكن تفسير البصمات أو الغياب قبل وجود جدول عمل فعّال للموظف في هذا التاريخ.';
      v_blocker:='Attendance Truth لا يعرف بداية ونهاية الشيفت أو ما إذا كان اليوم راحة.';
      v_owner:='schedule';
      v_confidence:=100;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','open_schedule','label','فتح جدول الموظف وإكمال الأيام الناقصة'),
        jsonb_build_object('id','create_date_override','label','إضافة Date Override إذا كان التغيير خاصًا بهذا اليوم'),
        jsonb_build_object('id','rematerialize','label','إعادة تحديث حقيقة الحضور بعد إصلاح الجدول')
      );

    when 'invalid_schedule_time' then
      v_root:='INVALID_SCHEDULE_TIME';
      v_title:='وقت الجدول ناقص أو غير صالح';
      v_diagnosis:='الجدول موجود لكن وقت الدخول أو الخروج غير صالح، لذلك لا يمكن حساب التأخير أو ساعات العمل.';
      v_blocker:='وقت بداية/نهاية الشيفت غير قابل للاستخدام.';
      v_owner:='schedule';
      v_confidence:=100;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','fix_schedule_time','label','تصحيح وقت بداية ونهاية الشيفت'),
        jsonb_build_object('id','rematerialize','label','إعادة تحديث حقيقة الحضور')
      );

    when 'schedule_conflict' then
      v_root:='SCHEDULE_CONFLICT';
      v_title:='أكثر من تعريف جدول متعارض';
      v_diagnosis:='يوجد أكثر من إعداد فعّال مختلف لنفس الموظف واليوم.';
      v_blocker:='لا يمكن للنظام اختيار جدول واحد بأمان.';
      v_owner:='schedule';
      v_confidence:=100;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','review_schedule_versions','label','مراجعة نسخ الجدول والتعارضات'),
        jsonb_build_object('id','keep_canonical_schedule','label','الإبقاء على تعريف واحد معتمد'),
        jsonb_build_object('id','rematerialize','label','إعادة تحديث حقيقة الحضور')
      );

    when 'sync_pending_verification' then
      v_root:='SYNC_NOT_COMPLETE';
      v_title:='المزامنة لم تكتمل حتى نهاية الشيفت';
      v_diagnosis:='لا يصح اعتبار الموظف غائبًا أو ناقص بصمة قبل وصول Watermark لما بعد نهاية الشيفت.';
      v_blocker:='اكتمال بيانات جهاز البصمة غير مؤكد حتى نهاية الشيفت.';
      v_owner:='sync';
      v_confidence:=100;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','check_branch_bridge','label','فحص Bridge ومزامنة الفرع'),
        jsonb_build_object('id','wait_sync','label','انتظار اكتمال المزامنة ثم إعادة التحديث')
      );

    when 'needs_event_review' then
      v_root:='PUNCH_INTERPRETATION_REQUIRED';
      v_title:='البصمات وصلت لكن تفسيرها يحتاج مراجعة';
      v_diagnosis:='يوجد حدث يدوي أو بصمة مرفوضة قابلة للإجراء تمنع الإغلاق التلقائي.';
      v_blocker:='Semantic interpretation غير محسوم.';
      v_owner:='system';
      v_confidence:=95;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','review_events','label','مراجعة Timeline البصمات الخام والمفسرة'),
        jsonb_build_object('id','reinterpret_punch','label','إعادة تصنيف البصمة كدخول/خروج عند وجود دليل'),
        jsonb_build_object('id','dismiss_duplicate','label','استبعاد البصمة المكررة إذا ثبت التكرار'),
        jsonb_build_object('id','rematerialize','label','إعادة تحديث حقيقة الحضور')
      );

    when 'invalid_duration' then
      v_root:='INVALID_WORK_DURATION';
      v_title:='مدة العمل الناتجة غير منطقية';
      v_diagnosis:='الدخول والخروج الحاليان ينتجان مدة صفرية أو سالبة أو أكبر من الحد الآمن.';
      v_blocker:='ساعات العمل المرشحة غير موثوقة.';
      v_owner:='system';
      v_confidence:=98;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','review_events','label','مراجعة ترتيب بصمات الدخول والخروج'),
        jsonb_build_object('id','reinterpret_punch','label','إعادة تفسير البصمات'),
        jsonb_build_object('id','rematerialize','label','إعادة تحديث حقيقة الحضور')
      );

    when 'absence_review' then
      v_root:='ABSENCE_AFTER_COMPLETE_SYNC';
      v_title:='لا توجد بصمات بعد اكتمال المزامنة';
      v_diagnosis:='الجدول موجود والمزامنة مكتملة ولا توجد بصمات حضور معتمدة أو إجازة مرتبطة؛ لذلك يلزم قرار إداري.';
      v_blocker:='سبب عدم الحضور غير معروف للنظام.';
      v_owner:='manager';
      v_confidence:=99;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','annual_leave','label','إجازة سنوية'),
        jsonb_build_object('id','exceptional_leave','label','إجازة عارضة'),
        jsonb_build_object('id','sick_leave','label','إجازة مرضية'),
        jsonb_build_object('id','approved_absence','label','غياب بإذن'),
        jsonb_build_object('id','shift_swap','label','تغيير يوم الراحة'),
        jsonb_build_object('id','absence_deduction','label','غياب بخصم للمراجعة المالية')
      );

    when 'missing_checkin' then
      if v_raw_count>=2 then
        v_root:='CHECKIN_INTERPRETATION_GAP';
        v_title:='بصمات موجودة لكن الدخول لم يُستخلص';
        v_diagnosis:='يوجد أكثر من حدث خام في نافذة الشيفت، لكن لم يتم اعتماد أي منها كبصمة دخول.';
        v_blocker:='تفسير الأحداث لا يطابق التسلسل المتوقع.';
        v_owner:='system';
        v_confidence:=95;
        v_actions:=jsonb_build_array(
          jsonb_build_object('id','review_events','label','مراجعة البصمات الخام'),
          jsonb_build_object('id','reinterpret_checkin','label','تعيين البصمة الصحيحة كدخول'),
          jsonb_build_object('id','rematerialize','label','إعادة تحديث حقيقة الحضور')
        );
      else
        v_root:='MISSING_CHECKIN';
        v_title:='بصمة الدخول غير موجودة';
        v_diagnosis:='المزامنة مكتملة ويوجد خروج بدون دخول موثق.';
        v_blocker:='لا يوجد دليل دخول كافٍ للإغلاق التلقائي.';
        v_owner:='manager';
        v_confidence:=95;
        v_actions:=jsonb_build_array(
          jsonb_build_object('id','forgot_in','label','نسيان بصمة الدخول بعد التحقق'),
          jsonb_build_object('id','device_fault','label','عطل جهاز مثبت'),
          jsonb_build_object('id','cross_branch','label','عمل بفرع آخر مثبت')
        );
      end if;

    when 'missing_checkout' then
      if v_raw_count>=2 then
        v_root:='CHECKOUT_INTERPRETATION_GAP';
        v_title:='بصمات موجودة لكن الخروج لم يُستخلص';
        v_diagnosis:='يوجد أكثر من حدث خام في نافذة الشيفت، لكن لم يتم اعتماد أي منها كبصمة خروج.';
        v_blocker:='تفسير الأحداث لا يطابق التسلسل المتوقع.';
        v_owner:='system';
        v_confidence:=95;
        v_actions:=jsonb_build_array(
          jsonb_build_object('id','review_events','label','مراجعة البصمات الخام'),
          jsonb_build_object('id','reinterpret_checkout','label','تعيين البصمة الصحيحة كخروج'),
          jsonb_build_object('id','rematerialize','label','إعادة تحديث حقيقة الحضور')
        );
      else
        v_root:='MISSING_CHECKOUT';
        v_title:='بصمة الخروج غير موجودة';
        v_diagnosis:='المزامنة مكتملة ويوجد دخول بدون خروج موثق.';
        v_blocker:='لا يوجد دليل خروج كافٍ للإغلاق التلقائي.';
        v_owner:='manager';
        v_confidence:=95;
        v_actions:=jsonb_build_array(
          jsonb_build_object('id','forgot_out','label','نسيان بصمة الخروج بعد التحقق'),
          jsonb_build_object('id','device_fault','label','عطل جهاز مثبت'),
          jsonb_build_object('id','cross_branch','label','عمل بفرع آخر مثبت')
        );
      end if;

    when 'early_leave_review' then
      v_root:='EARLY_LEAVE_WITHOUT_PERMISSION';
      v_title:='خروج قبل نهاية الشيفت بدون إذن مرتبط';
      v_diagnosis:='الخروج الفعلي أسبق من نهاية الجدول ولا يوجد إذن معتمد يغطي الحالة.';
      v_blocker:='النظام لا يعرف هل الخروج كان بإذن أم يستحق مراجعة مالية.';
      v_owner:='manager';
      v_confidence:=99;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','permission','label','تأخير/انصراف مبكر بإذن'),
        jsonb_build_object('id','time_deduction','label','إحالة الخصم للمراجعة المالية'),
        jsonb_build_object('id','schedule_error','label','تصحيح الجدول إذا كان الميعاد خطأ')
      );

    when 'worked_on_off' then
      v_root:='WORKED_ON_OFF_DAY';
      v_title:='بصمات عمل في يوم مسجل كراحة';
      v_diagnosis:='الموظف لديه حضور فعلي في يوم يعتبره الجدول يوم راحة.';
      v_blocker:='النظام لا يستطيع تحديد هل هذا عمل إضافي أم تغيير راحة أم خطأ جدول.';
      v_owner:='manager';
      v_confidence:=99;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','shift_swap','label','تغيير يوم الراحة'),
        jsonb_build_object('id','overtime_review','label','مراجعة عمل إضافي إذا كان العمل مطلوبًا'),
        jsonb_build_object('id','schedule_error','label','تصحيح الجدول إذا كانت الراحة مسجلة خطأ')
      );

    when 'time_off_with_events' then
      v_root:='TIMEOFF_WITH_ATTENDANCE_EVENTS';
      v_title:='يوجد حضور أثناء إجازة/غياب معتمد';
      v_diagnosis:='الطلب معتمد لكن توجد بصمات فعلية في نفس اليوم.';
      v_blocker:='لا يمكن اعتبار اليوم إجازة كاملة مع وجود دليل حضور دون مراجعة.';
      v_owner:='manager';
      v_confidence:=100;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','review_timeoff','label','مراجعة صحة الإجازة المعتمدة'),
        jsonb_build_object('id','review_events','label','مراجعة البصمات'),
        jsonb_build_object('id','cancel_or_adjust_timeoff','label','إلغاء/تعديل الإجازة إذا ثبت العمل')
      );

    when 'time_off_conflict' then
      v_root:='TIMEOFF_CONFLICT';
      v_title:='أكثر من إجازة/إذن معتمد على نفس اليوم';
      v_diagnosis:='يوجد أكثر من طلب معتمد يتداخل في نفس التاريخ.';
      v_blocker:='Attendance Truth لا يستطيع اختيار طلب واحد بشكل آمن.';
      v_owner:='timeoff';
      v_confidence:=100;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','review_timeoff','label','فتح سجل الإجازات والغياب'),
        jsonb_build_object('id','cancel_duplicate_timeoff','label','إلغاء الطلب المكرر/الخاطئ'),
        jsonb_build_object('id','rematerialize','label','إعادة تحديث حقيقة الحضور')
      );

    else
      v_root:='MANUAL_REVIEW_REQUIRED';
      v_title:='الحالة تحتاج مراجعة بشرية';
      v_diagnosis:='لم تصل الحالة إلى سبب آلي أكثر تحديدًا في Diagnostic Engine V1.';
      v_blocker:='لا يوجد مسار تلقائي آمن لهذه الحالة حتى الآن.';
      v_owner:='manager';
      v_confidence:=70;
      v_actions:=jsonb_build_array(
        jsonb_build_object('id','review_evidence','label','مراجعة الدليل والجدول والإجازات'),
        jsonb_build_object('id','document_decision','label','توثيق القرار الإداري')
      );
  end case;

  return jsonb_build_object(
    'staff_id',p_staff_id,
    'staff_name',v_staff.name,
    'branch',coalesce(v_row.branch,v_staff.branch),
    'date',p_date,
    'root_cause_code',v_root,
    'title',v_title,
    'diagnosis',v_diagnosis,
    'blocking_reason',v_blocker,
    'owner',v_owner,
    'confidence',v_confidence,
    'auto_fix_available',v_auto_fix,
    'suggested_actions',v_actions,
    'evidence',jsonb_build_object(
      'resolution_status',v_row.resolution_status,
      'resolution_reason',v_snap->>'reason',
      'raw_events',v_raw_count,
      'accepted_events',coalesce((v_snap->>'accepted_events')::int,0),
      'check_in_count',coalesce((v_snap->>'check_in_count')::int,0),
      'check_out_count',coalesce((v_snap->>'check_out_count')::int,0),
      'manual_review_events',coalesce((v_snap->>'manual_review_events')::int,0),
      'rejected_events',coalesce((v_snap->>'rejected_events')::int,0),
      'first_in',v_row.first_in,
      'last_out',v_row.last_out,
      'scheduled_start_at',v_row.scheduled_start_at,
      'scheduled_end_at',v_row.scheduled_end_at,
      'candidate_hours',v_row.candidate_hours,
      'late_minutes',coalesce(v_row.late_minutes,0),
      'early_leave_minutes',coalesce(v_row.early_leave_minutes,0),
      'schedule_id',v_row.schedule_id,
      'schedule_config_count',coalesce((v_snap->>'schedule_config_count')::int,0),
      'sync_complete_for_shift',coalesce((v_snap->>'sync_complete_for_shift')::boolean,false),
      'sync_complete_through',v_row.sync_complete_through,
      'time_off_kind',v_snap->>'time_off_kind',
      'time_off_request_id',v_row.time_off_request_id,
      'permission_attached',coalesce((v_snap->>'permission_attached')::boolean,false),
      'policy_version',v_row.policy_version
    ),
    'engine_version','attendance_diagnostic_v1',
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.attendance_case_diagnostic_v1(uuid,date) from public;
grant execute on function public.attendance_case_diagnostic_v1(uuid,date) to anon,authenticated,service_role;
