# التعديلات المُطبَّقة — 2026

> ملاحظة مهمة: لم يتم المساس بأي بيانات (لا قواعد بيانات ولا migrations ولا
> ملفات SQL). التعديلات كلها **كود فقط** وتحسين أداء.

## 1) `src/pages/ExecutiveDashboard2027.tsx` — تحسين أداء الداشبورد

**قبل:** الـ `load()` كان بيعمل 3 خطوات متسلسلة:
1. RPC summaries (parallel ✅)
2. ثم batch تاني (sales + staff + schedules + presence) parallel
3. ثم `fetchFollowupsForDashboard` **متسلسلة**
4. ثم `getStaffIncentiveSummaryForCycle` **متسلسلة**

وداخل بناء `scheduledToday` كان فيه `scheduleRows.find()` جوّا `.map()` →
تعقيد O(n × m) على JS thread (موظفين × schedules).

**بعد:**
- كل العمليات الثقيلة (sales truth + staff + schedules + presence + followups
  + incentives) في `Promise.all` واحدة. ده بيقلّل round-trips من 3 لـ 2.
- الـ followups بترجع `Promise.resolve([])` لو مش محتاجينها (نفس المنطق
  القديم) من غير ما تأخّر الـ batch.
- الـ incentives ملفوفة في `then(ok, err)` عشان فشلها ما يبطّلش الـ
  `Promise.all` (نفس سلوك الـ try/catch القديم).
- بناء `Map<key, schedule>` مرة واحدة بدل `.find()` لكل موظف →
  O(n + m) بدل O(n × m).

**النتيجة المتوقعة:** الداشبورد بيخلّص في زمن أقل ~30–45% حسب حجم البيانات،
خصوصًا لما عدد الموظفين كبير أو عدد schedules كبير.

## 2) `package.json` — تنظيف Dependencies

تم حذف الحزم غير المستخدمة (مفيش `import` لها في `src/`):
- `wouter` — routing مكرر (المشروع كله يستخدم react-router-dom)
- `three` — مكتبة 3D ثقيلة (~600KB) غير مستخدمة
- `axios` — غير مستخدمة (الكود يستخدم Supabase SDK + fetch)
- `@reduxjs/toolkit` و `react-redux` — غير مستخدمة (المشروع يستخدم
  zustand + react-query)

تم تصحيح إصدارات غير صالحة كانت تكسر `npm install`:
- `typescript`: `^6.0.3` (مش موجودة) → `~5.6.3`
- `@types/node`: `^25.3.3` (مش موجودة) → `^22.10.0` (Node 22 LTS)

**النتيجة:** bundle size أصغر، install أسرع وما يفشلش، ومفيش تعارض.

---

## توصيات مهمة لم يتم تنفيذها (تحتاج قرار منك)

### A. نقل aggregation الداشبورد إلى DB (الأهم للأداء)
حاليًا `fetchDashboardSalesTruth` بتسحب الفواتير صفحة-صفحة (1000 صف)
وتعمل الـ aggregation في المتصفح. لو الفترة شهر فيها 30,000 فاتورة، ده
لوحده ممكن يحتاج 30+ ثانية.

**الحل:** اعمل RPC واحدة على Supabase اسمها `get_dashboard_executive_v2`
ترجع summary + dailySales + branchDistribution + doctorSales +
recentInvoices (limit 50) في request واحد. ده هيخلي الداشبورد يخلص في
1-2 ثانية بدل 10-30.

**ليه ما عملتش ده؟** عشان يحتاج تعديل SQL على قاعدة البيانات بتاعتك،
والمستخدم طلب صراحة عدم المساس بالبيانات. لما تكون مستعد، أكتبلك الـ
SQL كاملة.

### B. تطبيق ملفات الـ indexes الموجودة عندك
موجود عندك `APPLY_THESE_INDEXES_IN_SUPABASE.sql` و
`PERFORMANCE_UPGRADE_SETUP.sql`. تأكد إنها متطبقة على Supabase production،
وخصوصًا الـ indexes على:
- `sales_invoices (invoice_date, branch)`
- `sales_invoices (branch, save_status)`
- `daily_followups (followup_date, branch)`

### C. تحسينات إضافية للداشبورد (لاحقًا)
- استخدم `useDeferredValue` للبحث في `Customers.tsx`.
- لف عناصر recharts (`R?.BarChart` إلخ) في `useMemo` لتفادي إعادة الإنشاء
  في كل re-render.
- استخدم `react-window` (موجود في deps) في جداول العملاء والفواتير
  الكبيرة.
- اضغط `dawaa-logo-full.jpeg` (342KB) واتحول لـ WebP.

### D. كانت في صفحة `Dashboard.tsx`
هي بس `<Navigate to="/executive-2027" />` — الأفضل تخليها redirect على
مستوى React Router بدل lazy chunk منفصل (يوفر network request صغير).
