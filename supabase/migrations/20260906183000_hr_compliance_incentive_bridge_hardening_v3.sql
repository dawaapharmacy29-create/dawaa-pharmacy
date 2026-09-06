-- HR compliance incentive bridge hardening v3
-- يثبت دورة النقاط الموحدة، يربط حالة الاعتماد الفعلية من employee_transactions بالحالة HR،
-- ويضيف تحققًا من سلامة سلسلة السجل والأدلة قبل أي اعتماد.

revoke execute on function public.hr_refresh_compliance_cases_v1(date,text) from service_role;
grant execute on function public.hr_refresh_compliance_cases_v1(date,text) to authenticated;

create or replace function public.hr_verify_case_chain_v1(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare r record; v_prev text:=null; v_expected text; v_ok boolean:=true; v_count int:=0; c record;
begin
  select * into c from public.hr_compliance_cases where id=p_case_id;
  if not found or not public.hr_can_view_branch_v1(c.branch) then
    raise exception using errcode='42501',message='not_authorized';
  end if;

  -- سلسلة event_hash تحتوي previous_hash. نتحقق من عدم وجود كسر في الربط ومن تطابق دليل الحالة نفسه.
  for r in select * from public.hr_compliance_case_events where case_id=p_case_id order by id
  loop
    v_count:=v_count+1;
    if coalesce(r.previous_hash,'')<>coalesce(v_prev,'') then v_ok:=false; end if;
    v_prev:=r.event_hash;
  end loop;
  v_expected:=encode(digest(c.evidence::text,'sha256'),'hex');
  if v_expected<>c.evidence_hash then v_ok:=false; end if;

  return jsonb_build_object('case_id',p_case_id,'chain_ok',v_ok,'events',v_count,'evidence_hash_ok',v_expected=c.evidence_hash,'last_event_hash',v_prev);
end;
$$;

create or replace function public.hr_review_compliance_case_v1(
  p_case_id uuid,
  p_decision text,
  p_note text,
  p_proposed_points_delta numeric default 0,
  p_proposed_money_delta numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare a record; c public.hr_compliance_cases%rowtype; v_status text; v_cycle record; v_cycle_label text; v_tx uuid; v_evidence_hash text;
begin
  select * into a from public.hr_current_actor_v1();
  if not found or a.role not in ('general_manager','executive_manager','branches_manager','admin','branch_manager') then
    raise exception using errcode='42501',message='غير مصرح بمراجعة حالات الالتزام';
  end if;
  select * into c from public.hr_compliance_cases where id=p_case_id for update;
  if not found then raise exception 'case_not_found'; end if;
  if not public.hr_can_view_branch_v1(c.branch) then raise exception using errcode='42501',message='خارج نطاق الفرع'; end if;
  if coalesce(a.staff_id,'')=c.staff_id::text then raise exception using errcode='42501',message='لا يمكن للموظف مراجعة أو اعتماد حالته بنفسه'; end if;
  if coalesce(btrim(p_note),'')='' then raise exception using errcode='22023',message='سبب المراجعة مطلوب'; end if;
  if c.status in ('closed','approved') then raise exception using errcode='55000',message='الحالة مقفلة وتحتاج مسار إعادة فتح منفصل'; end if;

  v_evidence_hash:=encode(digest(c.evidence::text,'sha256'),'hex');
  if v_evidence_hash<>c.evidence_hash then
    raise exception using errcode='55000',message='فشل تحقق سلامة دليل الحالة؛ ممنوع الاعتماد قبل المراجعة التقنية';
  end if;

  v_status:=case lower(p_decision) when 'approve' then 'approved' when 'reject' then 'rejected' else 'reviewed' end;
  if v_status='approved' and c.data_confidence<>'verified' then
    raise exception using errcode='55000',message='لا يمكن اعتماد أثر مالي قبل اكتمال وثقة بيانات الحضور';
  end if;

  if v_status='approved' and (coalesce(p_proposed_points_delta,0)<>0 or coalesce(p_proposed_money_delta,0)<>0) then
    if a.role not in ('general_manager','executive_manager','branches_manager','admin') then
      raise exception using errcode='42501',message='مدير الفرع يستطيع المراجعة لكن الأثر المالي يحتاج اعتماد إدارة أعلى';
    end if;
    select * into v_cycle from public.incentive_cycles ic where c.work_date between ic.cycle_start and ic.cycle_end order by ic.cycle_start desc limit 1;
    if found and lower(coalesce(v_cycle.status,'')) in ('locked','approved','paid','settled') then
      raise exception using errcode='55000',message='دورة الحوافز مقفلة ولا تقبل آثارًا مالية جديدة';
    end if;
  end if;

  update public.hr_compliance_cases set
    status=v_status,reviewed_by=a.account_id,reviewed_by_name=a.staff_name,reviewed_at=now(),review_note=p_note,
    proposed_points_delta=case when v_status='approved' then coalesce(p_proposed_points_delta,0) else 0 end,
    proposed_money_delta=case when v_status='approved' then coalesce(p_proposed_money_delta,0) else 0 end,
    approved_by=case when v_status='approved' then a.account_id else null end,
    approved_by_name=case when v_status='approved' then a.staff_name else null end,
    approved_at=case when v_status='approved' then now() else null end,
    incentive_status=case when v_status='approved' and (coalesce(p_proposed_points_delta,0)<>0 or coalesce(p_proposed_money_delta,0)<>0) then 'pending' else 'none' end,
    updated_at=now()
  where id=p_case_id;

  perform public.hr_append_case_event_v1(p_case_id,'manager_review',c.status,v_status,p_note,
    jsonb_build_object('points_delta',coalesce(p_proposed_points_delta,0),'money_delta',coalesce(p_proposed_money_delta,0),'evidence_hash',c.evidence_hash));

  if v_status='approved' and (coalesce(p_proposed_points_delta,0)<>0 or coalesce(p_proposed_money_delta,0)<>0) then
    v_cycle_label:=public.dawaa_current_points_cycle_label_v1();
    -- لو الحالة تخص دورة تاريخية، نستخدم دورة incentive_cycles إن وجدت بدل الدورة الحالية.
    if found and v_cycle.cycle_end is not null then v_cycle_label:=to_char(v_cycle.cycle_end,'YYYY-MM'); end if;

    insert into public.employee_transactions(
      staff_id,employee_id,employee_name,branch,type,title,reason,description,points_delta,points,amount,source,source_id,
      transaction_date,month_cycle,status,category,created_by,created_by_name,metadata
    ) values (
      c.staff_id,c.staff_id,c.staff_name,c.branch,
      case when coalesce(p_proposed_points_delta,0)<0 or coalesce(p_proposed_money_delta,0)<0 then 'penalty' else 'reward' end,
      'أثر التزام بانتظار الاعتماد','حالة موارد بشرية معتمدة للمراجعة',p_note,
      coalesce(p_proposed_points_delta,0),abs(coalesce(p_proposed_points_delta,0)),coalesce(p_proposed_money_delta,0),
      'hr_compliance_case',c.id,c.work_date,v_cycle_label,'pending','الالتزام والانضباط',a.staff_id,a.staff_name,
      jsonb_build_object('hr_case_id',c.id,'evidence_hash',c.evidence_hash,'requires_incentive_governance',true,'reviewed_by',a.staff_name)
    )
    on conflict do nothing returning id into v_tx;
    perform public.hr_append_case_event_v1(p_case_id,'incentive_pending',v_status,v_status,
      'تم إنشاء أثر حافز معلق وليس نهائيًا',jsonb_build_object('employee_transaction_id',v_tx,'month_cycle',v_cycle_label));
  end if;
  return jsonb_build_object('case_id',p_case_id,'status',v_status,'employee_transaction_id',v_tx);
end;
$$;

create or replace function public.hr_employee_transaction_status_bridge_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare v_case uuid; v_next text; v_old text;
begin
  if coalesce(new.source,old.source)<>'hr_compliance_case' then return new; end if;
  v_case:=coalesce(new.source_id,old.source_id);
  if v_case is null then return new; end if;
  v_old:=lower(coalesce(old.status,''));
  v_next:=case
    when lower(coalesce(new.status,'')) in ('approved','active') then 'approved'
    when lower(coalesce(new.status,'')) in ('rejected','cancelled','canceled','void') then 'rejected'
    else 'pending' end;
  update public.hr_compliance_cases
  set incentive_status=v_next,updated_at=now(),
      closed_at=case when v_next in ('approved','rejected') then coalesce(closed_at,now()) else closed_at end
  where id=v_case and incentive_status is distinct from v_next;
  if found then
    perform public.hr_append_case_event_v1(v_case,'incentive_status_changed',null,null,
      'تغيرت حالة أثر الحافز في سجل الحوافز',jsonb_build_object('from_transaction_status',v_old,'to_transaction_status',new.status,'mapped_status',v_next,'transaction_id',new.id));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_employee_transaction_status_bridge on public.employee_transactions;
create trigger trg_hr_employee_transaction_status_bridge
after update of status on public.employee_transactions
for each row when (old.source='hr_compliance_case' or new.source='hr_compliance_case')
execute function public.hr_employee_transaction_status_bridge_v1();

create or replace function public.hr_audit_employee_transaction_hr_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
begin
  if coalesce(case when tg_op='DELETE' then old.source else new.source end,'')='hr_compliance_case' then
    perform public.hr_sensitive_change_audit_v1();
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
-- لا نستعمل الدالة أعلاه كـ trigger wrapper لأن hr_sensitive_change_audit_v1 تعتمد TG_TABLE_NAME مباشرة.
-- لذلك نسجل employee_transactions HR بتريجر عام مع WHEN حتى لا نسجل باقي النظام.
drop trigger if exists trg_hr_audit_employee_transactions on public.employee_transactions;
create trigger trg_hr_audit_employee_transactions
after update or delete on public.employee_transactions
for each row when (old.source='hr_compliance_case')
execute function public.hr_sensitive_change_audit_v1();

revoke all on function public.hr_verify_case_chain_v1(uuid) from public;
grant execute on function public.hr_verify_case_chain_v1(uuid) to authenticated;

notify pgrst,'reload schema';
