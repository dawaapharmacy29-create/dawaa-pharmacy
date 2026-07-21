create or replace function public.enforce_staff_account_four_digit_pin()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  if new.temporary_password is distinct from old.temporary_password
     and new.temporary_password is not null
     and new.temporary_password !~ '^[0-9]{4}$' then
    raise exception 'كلمة المرور يجب أن تتكون من 4 أرقام فقط'
      using errcode = '23514';
  end if;

  if new.password_hash is distinct from old.password_hash
     and new.password_hash is not null then
    if new.password_hash ~ '^[0-9]{4}$' then
      new.password_hash := extensions.crypt(new.password_hash, extensions.gen_salt('bf'));
    elsif new.password_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
      raise exception 'password_hash must contain a bcrypt hash only'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
