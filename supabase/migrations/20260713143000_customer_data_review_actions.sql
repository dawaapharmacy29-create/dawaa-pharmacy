-- Safe review actions for customer data issues.
-- Approval changes only the reviewed customer's branch and writes a full audit record.

create or replace function public.review_customer_data_issue_v2(
  p_review_id uuid,
  p_decision text,
  p_reviewer text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.customer_data_review_queue%rowtype;
  v_customer public.customers%rowtype;
  v_suggested_branch text;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_reviewer text := nullif(btrim(coalesce(p_reviewer, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if v_decision not in ('approve', 'reject') then
    raise exception 'Unsupported review decision';
  end if;

  if v_reviewer is null then
    raise exception 'Reviewer name is required';
  end if;

  select * into v_review
  from public.customer_data_review_queue
  where id = p_review_id
  for update;

  if not found then
    raise exception 'Review item not found';
  end if;

  if v_review.status <> 'pending' then
    raise exception 'Review item has already been processed';
  end if;

  if v_decision = 'reject' then
    update public.customer_data_review_queue
    set status = 'rejected',
        reviewed_by = v_reviewer,
        reviewed_at = now(),
        updated_at = now(),
        suggested_value = coalesce(suggested_value, '{}'::jsonb) || jsonb_build_object(
          'review_note', p_note,
          'decision', 'reject'
        )
    where id = p_review_id;

    return jsonb_build_object('ok', true, 'decision', 'reject', 'review_id', p_review_id);
  end if;

  if v_review.issue_type <> 'registered_branch_conflict' then
    raise exception 'This review type cannot update the customer automatically';
  end if;

  v_suggested_branch := nullif(btrim(v_review.suggested_value ->> 'suggested_branch'), '');
  if v_suggested_branch not in ('فرع شكري', 'فرع الشامي') then
    raise exception 'Suggested branch is invalid';
  end if;

  if v_review.customer_id is null then
    raise exception 'Review item is not linked to a customer';
  end if;

  select * into v_customer
  from public.customers
  where id = v_review.customer_id
  for update;

  if not found then
    raise exception 'Customer not found';
  end if;

  insert into public.customer_data_change_log (
    customer_id,
    customer_code,
    operation,
    before_data,
    after_data,
    reason,
    changed_by
  ) values (
    v_customer.id,
    v_customer.customer_code::text,
    'approved_customer_branch_review',
    jsonb_build_object(
      'branch', v_customer.branch,
      'customer_name', v_customer.name,
      'review_id', p_review_id
    ),
    jsonb_build_object(
      'branch', v_suggested_branch,
      'confidence_percent', v_review.suggested_value -> 'confidence_percent',
      'review_id', p_review_id
    ),
    coalesce(p_note, 'Approved from customer data review page'),
    v_reviewer
  );

  update public.customers
  set branch = v_suggested_branch,
      updated_at = now()
  where id = v_customer.id;

  update public.customer_data_review_queue
  set status = 'resolved',
      reviewed_by = v_reviewer,
      reviewed_at = now(),
      updated_at = now(),
      suggested_value = coalesce(suggested_value, '{}'::jsonb) || jsonb_build_object(
        'review_note', p_note,
        'decision', 'approve',
        'applied_branch', v_suggested_branch
      )
  where id = p_review_id;

  return jsonb_build_object(
    'ok', true,
    'decision', 'approve',
    'review_id', p_review_id,
    'customer_id', v_customer.id,
    'branch', v_suggested_branch
  );
end;
$$;

revoke all on function public.review_customer_data_issue_v2(uuid, text, text, text) from public;
grant execute on function public.review_customer_data_issue_v2(uuid, text, text, text) to authenticated;
