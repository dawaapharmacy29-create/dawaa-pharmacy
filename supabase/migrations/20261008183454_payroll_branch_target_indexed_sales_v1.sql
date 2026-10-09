create or replace function public.dawaa_branch_target_progress_for_cycle_v1(
  p_branch text,
  p_cycle_start date,
  p_cycle_end date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_branch text;
  v_aliases text[];
  v_target_id uuid;
  v_target_amount numeric:=0;
  v_invoices_main integer:=0;
  v_sales_main numeric:=0;
  v_invoices_fallback integer:=0;
  v_sales_fallback numeric:=0;
  v_invoices integer:=0;
  v_sales numeric:=0;
  v_elapsed integer:=1;
  v_total integer:=1;
  v_achievement numeric:=0;
  v_avg numeric:=0;
  v_remaining numeric:=0;
  v_required_daily numeric:=0;
  v_required_remaining numeric:=0;
  v_projected numeric:=0;
  v_projected_pct numeric:=0;
  v_status text;
  v_advice text;
begin
  if p_cycle_start is null or p_cycle_end is null or p_cycle_end < p_cycle_start then
    raise exception 'invalid_branch_target_cycle' using errcode='22023';
  end if;

  v_branch:=case
    when trim(coalesce(p_branch,'')) in ('فرع الشامي','الشامي') then 'فرع الشامي'
    when trim(coalesce(p_branch,'')) in ('فرع شكري','شكري') then 'فرع شكري'
    else nullif(trim(coalesce(p_branch,'')),'')
  end;
  if v_branch is null then return '{}'::jsonb; end if;
  v_aliases:=case when v_branch='فرع الشامي' then array['فرع الشامي','الشامي']::text[] when v_branch='فرع شكري' then array['فرع شكري','شكري']::text[] else array[v_branch]::text[] end;

  select bst.id,bst.target_amount
  into v_target_id,v_target_amount
  from public.branch_sales_targets bst
  where coalesce(bst.active,false)
    and trim(coalesce(bst.branch_name,''))=any(v_aliases)
    and (case
      when extract(day from current_date)::int >= coalesce(bst.cycle_start_day,26)
        then make_date(extract(year from current_date)::int,extract(month from current_date)::int,coalesce(bst.cycle_start_day,26))
      else (make_date(extract(year from current_date)::int,extract(month from current_date)::int,coalesce(bst.cycle_start_day,26))-interval '1 month')::date
    end)=p_cycle_start
    and ((case
      when extract(day from current_date)::int >= coalesce(bst.cycle_start_day,26)
        then make_date(extract(year from current_date)::int,extract(month from current_date)::int,coalesce(bst.cycle_start_day,26))
      else (make_date(extract(year from current_date)::int,extract(month from current_date)::int,coalesce(bst.cycle_start_day,26))-interval '1 month')::date
    end)+interval '1 month -1 days')::date=p_cycle_end
  order by bst.updated_at desc nulls last,bst.created_at desc nulls last
  limit 1;

  if v_target_id is null then return '{}'::jsonb; end if;

  select count(*)::int,
         coalesce(sum(coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)),0)
  into v_invoices_main,v_sales_main
  from public.sales_invoices si
  where si.branch=any(v_aliases)
    and si.invoice_date >= p_cycle_start::timestamptz
    and si.invoice_date < (p_cycle_end+1)::timestamptz
    and not (lower(coalesce(si.save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
      or lower(coalesce(si.invoice_type,'')) ~ '(معلق|pending|draft)')
    and btrim(coalesce(si.customer_code,'')) <> all(array['5','10','54','170','4902','12820']::text[]);

  select count(*)::int,
         coalesce(sum(coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)),0)
  into v_invoices_fallback,v_sales_fallback
  from public.sales_invoices si
  where si.branch=any(v_aliases)
    and si.invoice_date is null
    and coalesce(si.sale_date,si.created_at::date) between p_cycle_start and p_cycle_end
    and not (lower(coalesce(si.save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
      or lower(coalesce(si.invoice_type,'')) ~ '(معلق|pending|draft)')
    and btrim(coalesce(si.customer_code,'')) <> all(array['5','10','54','170','4902','12820']::text[]);

  v_invoices:=coalesce(v_invoices_main,0)+coalesce(v_invoices_fallback,0);
  v_sales:=coalesce(v_sales_main,0)+coalesce(v_sales_fallback,0);
  v_elapsed:=greatest(least(current_date,p_cycle_end)-p_cycle_start+1,1);
  v_total:=greatest(p_cycle_end-p_cycle_start+1,1);
  v_achievement:=round(v_sales/nullif(v_target_amount,0)*100,2);
  v_avg:=round(v_sales/v_elapsed::numeric,2);
  v_remaining:=round(greatest(v_target_amount-v_sales,0),2);
  v_required_daily:=round(v_target_amount/v_total::numeric,2);
  v_required_remaining:=round(v_remaining/greatest(p_cycle_end-current_date+1,1)::numeric,2);
  v_projected:=round(v_avg*v_total::numeric,2);
  v_projected_pct:=round(v_avg*v_total::numeric/nullif(v_target_amount,0)*100,2);
  v_status:=case when v_sales>=v_target_amount then 'تم تحقيق التارجت' when (v_avg*v_total::numeric/nullif(v_target_amount,0))>=1 then 'على المسار الصحيح' when (v_avg*v_total::numeric/nullif(v_target_amount,0))>=0.85 then 'قريب لكن يحتاج متابعة يومية' else 'خطر عدم تحقيق التارجت' end;
  v_advice:=case when v_sales>=v_target_amount then 'حافظ على نفس الأداء وركز على جودة الخدمة وعدم فقد العملاء.' when (v_avg*v_total::numeric/nullif(v_target_amount,0))>=1 then 'الأداء جيد. ركز على العملاء المهمين وزيادة متوسط الفاتورة.' when (v_avg*v_total::numeric/nullif(v_target_amount,0))>=0.85 then 'راجع الشيفت الأقل مبيعًا، فعّل متابعة العملاء المهمين، واطلب من الفريق عروض مكملة مع كل فاتورة.' else 'اجتماع عاجل مع مدير الفرع: متابعة العملاء المتوقفين، مراجعة الرواكد، تفعيل عروض يومية، ومراقبة متوسط الفاتورة لكل شيفت.' end;
  return jsonb_build_object('target_id',v_target_id,'branch',v_branch,'cycle_start',p_cycle_start,'cycle_end',p_cycle_end,'target_amount',v_target_amount,'invoices_count',v_invoices,'sales_total',v_sales,'elapsed_days',v_elapsed,'total_days',v_total,'achievement_percent',v_achievement,'avg_daily_sales',v_avg,'remaining_amount',v_remaining,'required_daily_sales',v_required_daily,'required_daily_remaining',v_required_remaining,'projected_sales',v_projected,'projected_achievement_percent',v_projected_pct,'target_status',v_status,'manager_advice',v_advice);
end;
$$;