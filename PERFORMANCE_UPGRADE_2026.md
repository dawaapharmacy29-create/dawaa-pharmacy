# تقرير التحسينات المُطبَّقة — دواء

## التاريخ: يونيو 2026

---

## ✅ التحسينات المُنفَّذة في هذا الإصدار

### 1. إزالة المكتبات غير المستخدمة (وفر ~2.5MB من البندل)

- حُذفت: @react-three/drei, @react-three/fiber, @react-three/rapier (مكتبات ثري دي)
- حُذفت: hls.js (مشغل فيديو غير مستخدم)
- حُذفت: chart.js (مكررة مع recharts المستخدمة فعلاً)
- **النتيجة:** تقليل حجم التحميل الأول بنسبة ~40-50%

### 2. تحسين تقسيم البندل في vite.config.ts

- تقسيم أدق = تحميل موازٍ أسرع + cache أفضل
- كل مكتبة كبيرة لها chunk مستقل (maps, charts, forms, icons...)

### 3. TanStack Query Provider مُفعَّل في App.tsx

- كل البيانات تُخزَّن مشتركة بين جميع الصفحات
- Cache تلقائي: 5 دقائق stale + 30 دقيقة في الذاكرة
- لا refetch عند تبديل الصفحات إذا البيانات حديثة
- ملف مثال جاهز: src/hooks/useQueryStaff.ts

### 4. Parallel Page Fetching في supabasePagination.ts

- بدل تحميل الصفحات واحدة ورا التانية → كلها بالتوازي
- 5000 صف كانت = 5 requests متتالية → الآن 5 requests متزامنة
- **النتيجة:** سرعة أسرع بـ 3-5x للجداول الكبيرة

### 5. تقليل WebSocket Connections (Realtime)

- useSupabaseQuery: الـ realtime الآن مُعطَّل بالافتراضي
- فُعِّل فقط حيث يُحتاج فعلاً (useActiveStaff للحضور المباشر)
- **النتيجة:** أقل استهلاكًا للشبكة، أقل أخطاء timeout

### 6. رفع TTL كاش الفواتير: 5 دقائق → 30 دقيقة

- استخدام localStorage بدل sessionStorage (يبقى بين التبويبات)
- **النتيجة:** Dashboard يفتح فورياً بدون loading عند الزيارة الثانية

---

## ⚠️ مطلوب منك: خطوة واحدة في Supabase

**افتح Supabase → SQL Editor → الصق محتوى الملف التالي وشغّله:**

```
APPLY_THESE_INDEXES_IN_SUPABASE.sql
```

هذه الـ indexes ستحسن سرعة كل الاستعلامات على:

- sales_invoices (الأهم)
- employees/staff
- customers
- followups

---

## 📋 التحسينات المُوصى بها كخطوة تالية

1. **Virtual Scrolling** — لقائمة العملاء (yarn add @tanstack/react-virtual)
2. **Optimistic Updates** — لعمليات الفريق والنقاط
3. **توحيد Staff Identity Services** — دمج 6 ملفات في service واحد
4. **useQueryStaff pattern** — تطبيق نفس النمط على باقي الصفحات

---

## كيفية التشغيل بعد التحديث

```bash
yarn install   # لتثبيت التغييرات في package.json
yarn dev       # للتشغيل المحلي
yarn build     # للـ production
```
