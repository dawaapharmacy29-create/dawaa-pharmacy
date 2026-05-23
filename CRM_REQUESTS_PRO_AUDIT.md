# Dawaa Pharmacy 2027 - CRM Requests Pro Audit

## Build verification
- Production build completed successfully.
- Result: `✓ built in 25.10s`.
- Only remaining warning: large JavaScript chunk size from the existing app bundle. This does not block runtime.

## New module added: طلبات العملاء
A new integrated page was added at:

`/customer-requests`

It is also added to the right sidebar under customer-service related workflows.

## Purpose
This module tracks unavailable item requests from the moment a doctor records the customer need until purchasing, customer confirmation, arrival, contact, delivery/sale, or closure.

## Data flow
1. Doctor or customer-service user records a missing medicine request.
2. The request is saved to `customer_requests`.
3. Status changes are logged in `customer_request_events`.
4. Customer service can contact the customer by WhatsApp from the request details.
5. Purchasing notes, supplier hints, customer confirmation, and closure status remain attached to the same request.
6. The request can be searched by customer name, code, phone, medicine name, doctor, or supplier hint.

## Status flow
- طلب جديد
- قيد مراجعة المشتريات
- جاري البحث عند الموردين
- يحتاج تأكيد العميل
- تم تأكيد العميل
- جاري التوفير
- تم توفيره
- وصل للصيدلية
- تم التواصل مع العميل
- تم التسليم / البيع
- مغلق
- ملغي
- غير متوفر

## Customer-service integration
The Customer Service page now includes a direct button to open `طلبات العملاء`, so urgent customer requests and normal daily followups stay connected in one workflow.

## SQL file to run
Run this after the existing Dawaa Pharmacy 2027 SQL files:

`supabase/20260523_customer_requests_crm_pro.sql`

## New evaluation rules included when compatible
If the `evaluation_rules` table has the expected Dawaa 2027 schema, the SQL adds flexible rules for:
- تسجيل طلب عميل كامل البيانات
- تجاهل طلب عميل عاجل
- توفير صنف غالي بدون تأكيد العميل

The SQL is defensive and checks columns before adding these rules.

## Files added/modified
- Added: `src/lib/api/customerRequests.ts`
- Added: `src/pages/CustomerRequests.tsx`
- Modified: `src/App.tsx`
- Modified: `src/components/layout/Sidebar.tsx`
- Modified: `src/pages/CustomerService.tsx`
- Added: `supabase/20260523_customer_requests_crm_pro.sql`

## Notes
This is built on the current codebase and does not start the application from scratch. It avoids using old point-record sources and adds this workflow as a new official CRM area.
