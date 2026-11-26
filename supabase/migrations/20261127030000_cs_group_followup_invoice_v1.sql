-- جروب المتابعات (صاحب الصيدلية 2026-11-26): الكود أو رقم الفاتورة بيتكتبوا بإيد. رقم الفاتورة بيجيب كود العميل من
-- فواتير البيع في الفرع (من غير عميل الصيدلية والتحويلات)، وبيتحفظ مع الحالة. وأنواع المتابعة الجديدة
-- («أخد بديل» و«مهتم بحاجة») بتتحفظ بدل ما تتشال.

alter table public.cs_group_followups add column if not exists invoice_number text;

do $do$
declare
  d text := pg_get_functiondef('public.dawaa_cs_group_followups_import_v1(text, text, jsonb)'::regprocedure);
  rep text[][] := array[
    [$a$'register', 'general') then x.kind end as kind,$a$,
     $a$'register', 'general', 'alternative', 'interest') then x.kind end as kind,$a$],
    [$a$nullif(btrim(x.customer_code), '') as code,$a$,
     $a$coalesce(nullif(btrim(x.customer_code), ''),
             (select btrim(s.customer_code) from public.sales_invoices s
               where s.branch = v_branch and s.invoice_number = nullif(regexp_replace(coalesce(x.invoice, ''), '\D', '', 'g'), '')
                 and btrim(coalesce(s.customer_code, '')) not in ('', '0', '7', '10', '170')
               order by s.invoice_date desc limit 1)) as code,
           nullif(regexp_replace(coalesce(x.invoice, ''), '\D', '', 'g'), '') as invoice,$a$],
    [$a$brief text, due_date text, items jsonb, patient text, urgent boolean)$a$,
     $a$brief text, due_date text, items jsonb, patient text, urgent boolean, invoice text)$a$],
    [$a$customer_phone, customer_name, body, file_name, imported_by, imported_by_name, kind, brief, due_date, items, patient, urgent)$a$,
     $a$customer_phone, customer_name, body, file_name, imported_by, imported_by_name, kind, brief, due_date, items, patient, urgent,
      invoice_number)$a$],
    [$a$r.items, r.patient, r.urgent)$a$,
     $a$r.items, r.patient, r.urgent, r.invoice)$a$],
    [$a$customer_code = coalesce(g.customer_code, excluded.customer_code),$a$,
     $a$customer_code = coalesce(excluded.customer_code, g.customer_code),
          invoice_number = coalesce(excluded.invoice_number, g.invoice_number),$a$]
  ];
  i int;
begin
  for i in 1 .. array_length(rep, 1) loop
    if position(rep[i][1] in d) = 0 then raise exception 'pattern % not found', i; end if;
    d := replace(d, rep[i][1], rep[i][2]);
  end loop;
  execute d;
end;
$do$;
