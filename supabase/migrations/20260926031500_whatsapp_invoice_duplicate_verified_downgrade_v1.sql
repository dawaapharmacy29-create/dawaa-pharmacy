-- Step 3 invoice header truth repair.
-- The same invoice may legitimately appear across split/follow-up sessions, but without an explicit
-- invoice-number mention in the source transcript it must not remain auto-verified in more than one
-- WhatsApp source. Preserve the candidate link; downgrade certainty only.

with duplicated as (
  select matched_invoice_id
  from public.whatsapp_review_sources
  where matched_invoice_id is not null
  group by matched_invoice_id
  having count(*) > 1
)
update public.whatsapp_review_sources s
set
  invoice_match_status = 'needs_review',
  invoice_match_confidence = least(coalesce(s.invoice_match_confidence,0), 0.60),
  invoice_match_reason = 'نفس الفاتورة مرتبطة بأكثر من جلسة واتساب بدون ذكر مباشر لرقم الفاتورة؛ يلزم اعتماد بشري لتحديد الجلسة الصحيحة.',
  updated_at = now()
from duplicated d
where s.matched_invoice_id=d.matched_invoice_id
  and s.invoice_match_status='verified'
  and not (
    s.raw_text is not null
    and s.matched_invoice_number is not null
    and s.raw_text ~* (
      '(فاتور[هة]|invoice|inv)[^0-9]{0,8}' ||
      regexp_replace(s.matched_invoice_number,'[^0-9]','','g')
    )
  );
