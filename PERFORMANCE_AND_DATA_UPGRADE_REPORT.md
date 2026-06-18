# Dawaa Pharmacy 2027 V2 — Performance & Data Upgrade Report

## ملخص التنفيذ

تم تنفيذ نسخة محسنة تركّز على رفع الأداء وتقليل الضغط على المتصفح وSupabase، مع الحفاظ على شكل التطبيق الحالي وعدم حذف أي بيانات.

## أهم التعديلات المنفذة

### 1) خدمة مركزية لمقارنة الفروع

تم إنشاء:

`src/lib/sales/salesTruthService.ts`

وتستخدم الآن صفحة مقارنة الفروع مصدرًا موحدًا وسريعًا:

- تحاول أولًا استخدام RPC: `get_branch_comparison_v2`
- إذا لم يكن الـ RPC موجودًا، تعمل fallback آمن من `sales_invoices`
- تعرض مصدر التحميل في الصفحة: RPC سريع أو fallback
- لا تعتمد على mock data

### 2) تحسين صفحة مقارنة الفروع

تم تعديل:

`src/pages/BranchComparison.tsx`

بحيث تعتمد على `salesTruthService` بدل الحساب المباشر داخل الصفحة، لتقليل التكرار وتحسين الدقة.

### 3) تحسين مستويات ولاء العملاء

تم تعديل:

`src/lib/customers/loyaltyTiersService.ts`

الصفحة تحاول استخدام RPC سريع:

`get_loyalty_tiers_v2`

ثم تعمل fallback تلقائيًا إذا لم يكن الـ RPC موجودًا.

### 4) تحسين الموجودين حاليًا في الشيفت

تم تعديل:

`src/lib/attendance/currentShiftPresenceService.ts`

ليحاول استخدام RPC:

`get_today_shift_presence_v2`

ثم fallback إلى قراءة `shift_schedules.day_name`، مع الحفاظ على منطق ظهور الموظف حتى لو لم يبصم.

### 5) تقليل select("\*") في بحث العملاء

تم تعديل:

`src/lib/customerSearch.ts`

ليستخدم أعمدة محددة بدل `select("*")` في البحث، مما يقلل نقل البيانات ويحسن السرعة.

### 6) تنظيف Dependencies غير مستخدمة

تم حذف مكتبات ثقيلة غير مستخدمة داخل src:

- three
- @react-three/fiber
- @react-three/drei
- @react-three/rapier
- leaflet
- react-leaflet
- hls.js
- react-redux
- @reduxjs/toolkit
- qrcode
- react-calendar
- react-dropzone
- react-icons

هذا يقلل حجم التثبيت ومخاطر build على Vercel.

### 7) SQL أداء جديد

تم إنشاء ملف:

`PERFORMANCE_UPGRADE_SETUP.sql`

ويحتوي على:

- Indexes مهمة لـ `sales_invoices`, `shift_schedules`, `attendance`, `customers`
- RPC `get_branch_comparison_v2`
- RPC `get_loyalty_tiers_v2`
- RPC `get_today_shift_presence_v2`

## ملفات تم تعديلها/إضافتها

- `src/lib/sales/salesTruthService.ts` جديد
- `src/pages/BranchComparison.tsx`
- `src/lib/customers/loyaltyTiersService.ts`
- `src/lib/attendance/currentShiftPresenceService.ts`
- `src/lib/customerSearch.ts`
- `package.json`
- `package-lock.json`
- `PERFORMANCE_UPGRADE_SETUP.sql` جديد
- `PERFORMANCE_AND_DATA_UPGRADE_REPORT.md` جديد

## نتيجة الاختبارات

- `npm install` نجح
- `npm run build` نجح

ملاحظة: `npm run typecheck` ما زال يظهر أخطاء TypeScript قديمة ومتعددة في المشروع، وكانت موجودة في أجزاء كثيرة من التطبيق، لكن build production نجح. لم يتم حل كل أخطاء typecheck في هذه المرحلة لأن المطلوب كان تحسين الأداء والربط بدون refactor شامل يكسر النسخة.

## المطلوب بعد رفع النسخة

1. ارفع النسخة إلى GitHub/Vercel.
2. شغّل في Supabase:
   - `CUSTOMER_CODING_SETUP.sql` إذا لم يتم تشغيله سابقًا.
   - `PERFORMANCE_UPGRADE_SETUP.sql` الجديد.
3. اعمل Redeploy في Vercel.
4. اختبر:
   - `/branch-comparison`
   - `/loyalty-tiers`
   - `/team`
   - الداشبورد: الموجودون حاليًا في الشيفت
   - `/customer-coding`

## ملاحظات مهمة

- لو لم تشغل `PERFORMANCE_UPGRADE_SETUP.sql`، التطبيق سيعمل بالـ fallback، لكنه لن يستفيد من أقصى سرعة ممكنة.
- بعد تشغيل SQL الجديد، مقارنة الفروع ومستويات الولاء والشيفتات المفترض تكون أسرع وأكثر ثباتًا.
