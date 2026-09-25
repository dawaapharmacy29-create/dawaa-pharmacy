-- Step 3: resolve the final three legacy pending header matches using source transcript + invoice header truth.

update public.whatsapp_review_sources
set
  invoice_match_status='verified',
  matched_invoice_id='5cb98286-814c-44e9-9896-0975dc5372d5',
  matched_invoice_number='35205',
  matched_invoice_date='2026-09-15 14:10:00+00',
  matched_invoice_value=2025,
  invoice_match_confidence=0.9272727272727272,
  invoice_match_reason='فاتورة أثناء نفس المحادثة، نفس العميل والفرع، وقيمة 2025 جنيه تطابق الإجمالي المذكور صراحة في المحادثة.',
  updated_at=now()
where id='2b17106c-fb69-4b4e-ad83-f5aa41303c86'
  and invoice_match_status='pending';

update public.whatsapp_review_sources
set
  invoice_match_status='probable',
  matched_invoice_id='recovery20260821_shokry_68466',
  matched_invoice_number='68466',
  matched_invoice_date='2026-08-20 08:27:00+00',
  matched_invoice_value=410,
  invoice_match_confidence=0.7636363636363637,
  invoice_match_reason='الفاتورة تمت أثناء المحادثة وفي نفس دقيقة رسالة تم الإرسال ونفس العميل والفرع؛ فرق القيمة يمنع الاعتماد كـ verified.',
  updated_at=now()
where id='44999fee-c39e-4e40-a66c-b21223775d51'
  and invoice_match_status='pending';

update public.whatsapp_review_sources
set
  invoice_match_status='not_applicable',
  matched_invoice_id=null,
  matched_invoice_number=null,
  matched_invoice_date=null,
  matched_invoice_value=null,
  invoice_match_confidence=1,
  invoice_match_reason='المحادثة متابعة خدمة/اطمئنان فقط ولا تحتوي فرصة بيع أو طلب شراء مؤهل لمطابقة فاتورة.',
  updated_at=now()
where id='6fe6a00a-d7a5-4f9a-8e81-a72c1b2c9d33'
  and invoice_match_status='pending';

do $$
declare
  pending_count integer;
begin
  select count(*) into pending_count
  from public.whatsapp_review_sources
  where invoice_match_status='pending';
  if pending_count <> 0 then
    raise exception 'WhatsApp invoice matching still has % pending rows', pending_count;
  end if;
end $$;
