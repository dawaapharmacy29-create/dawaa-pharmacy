-- Hotfix: quick_reply_scripts uses text[] columns, while the app passes RPC list
-- parameters as jsonb. Convert safely inside the RPC without changing schema.

create or replace function public.save_quick_reply_script(
  p_id uuid,
  p_shortcut text,
  p_title text,
  p_category text,
  p_script_type text,
  p_doctor_name text,
  p_branch text,
  p_message_body text,
  p_questions jsonb,
  p_suggested_products jsonb,
  p_tags jsonb,
  p_active boolean,
  p_actor_id text,
  p_actor_name text
)
returns public.quick_reply_scripts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.quick_reply_scripts;
  v_questions text[];
  v_suggested_products text[];
  v_tags text[];
begin
  if not public.app_role_allowed(p_actor_id, array['general_manager','admin','customer_service_manager','branch_manager']) then
    raise exception 'ليس لديك صلاحية حفظ الردود السريعة أو لم يتم تفعيل صلاحيات الجدول.';
  end if;

  v_questions := case
    when p_questions is null then array[]::text[]
    when jsonb_typeof(p_questions) = 'array' then array(select jsonb_array_elements_text(p_questions))
    else array[]::text[]
  end;

  v_suggested_products := case
    when p_suggested_products is null then array[]::text[]
    when jsonb_typeof(p_suggested_products) = 'array' then array(select jsonb_array_elements_text(p_suggested_products))
    else array[]::text[]
  end;

  v_tags := case
    when p_tags is null then array[]::text[]
    when jsonb_typeof(p_tags) = 'array' then array(select jsonb_array_elements_text(p_tags))
    else array[]::text[]
  end;

  if p_id is not null then
    update public.quick_reply_scripts
    set shortcut = case when left(trim(p_shortcut), 1) = '/' then trim(p_shortcut) else '/' || trim(p_shortcut) end,
        title = trim(p_title),
        category = coalesce(nullif(trim(p_category), ''), 'عام'),
        script_type = coalesce(nullif(trim(p_script_type), ''), 'quick_reply'),
        doctor_name = nullif(trim(coalesce(p_doctor_name, '')), ''),
        branch = nullif(trim(coalesce(p_branch, '')), ''),
        message_body = trim(p_message_body),
        questions = v_questions,
        suggested_products = v_suggested_products,
        tags = v_tags,
        active = coalesce(p_active, true),
        created_by = coalesce(created_by, p_actor_id),
        created_by_name = coalesce(created_by_name, p_actor_name),
        updated_at = now()
    where id = p_id
    returning * into v_row;
  else
    insert into public.quick_reply_scripts (
      shortcut, title, category, script_type, doctor_name, branch, message_body,
      questions, suggested_products, tags, active, usage_count, created_by, created_by_name, created_at, updated_at
    )
    values (
      case when left(trim(p_shortcut), 1) = '/' then trim(p_shortcut) else '/' || trim(p_shortcut) end,
      trim(p_title),
      coalesce(nullif(trim(p_category), ''), 'عام'),
      coalesce(nullif(trim(p_script_type), ''), 'quick_reply'),
      nullif(trim(coalesce(p_doctor_name, '')), ''),
      nullif(trim(coalesce(p_branch, '')), ''),
      trim(p_message_body),
      v_questions,
      v_suggested_products,
      v_tags,
      coalesce(p_active, true),
      0,
      p_actor_id,
      p_actor_name,
      now(),
      now()
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;
