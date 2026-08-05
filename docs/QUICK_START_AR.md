## البدء السريع - Quick Start Guide

### 📋 المتطلبات

- Node.js >= 16
- npm أو yarn
- Git
- متصفح حديث

---

## 🚀 الخطوات

### الخطوة 1: استنساخ المشروع

```bash
git clone https://github.com/your-username/dawaa-pharmacy-2027-v2.git
cd dawaa-pharmacy-2027-v2
```

### الخطوة 2: تثبيت الاعتمادات

```bash
npm install
# أو
yarn install
```

### الخطوة 3: تشغيل البيئة المحلية

```bash
npm run dev
# أو
yarn dev
```

سيفتح التطبيق على: `http://localhost:5173`

---

## 📂 بنية المشروع

```
src/
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx       ← تم تحسينه ✅
│   │   ├── Layout.tsx
│   │   └── Header.tsx
│   ├── common/
│   ├── dashboard/
│   └── ...
├── pages/
│   ├── ExecutiveDashboard2027.tsx ← الداشبورد الرئيسي
│   ├── DoctorDashboard.tsx
│   └── ...
├── lib/
│   ├── dashboard/
│   │   ├── dashboardOptimizations.ts  ← ملف جديد ✅
│   │   └── dashboardTruthService.ts
│   ├── performance/
│   │   └── performanceOptimizations.ts ← ملف جديد ✅
│   └── ...
├── hooks/
├── context/
└── styles/
```

---

## 🆕 الملفات الجديدة

### 1. `src/lib/dashboard/dashboardOptimizations.ts`

**الهدف**: تحسينات الداشبورد والتعامل مع البيانات الفارغة

**الاستخدام**:

```typescript
import { ensureValidDashboardData, hasSalesData } from '@/lib/dashboard/dashboardOptimizations';

const validData = ensureValidDashboardData(fetchedData);
if (hasSalesData(validData.summary)) {
  // عرض البيانات
}
```

### 2. `src/lib/performance/performanceOptimizations.ts`

**الهدف**: تحسينات الأداء والتخزين المؤقت

**الاستخدام**:

```typescript
import { PerformanceCache, memoizeSelector } from '@/lib/performance/performanceOptimizations';

const cache = new PerformanceCache(5 * 60 * 1000);
```

---

## 📝 تحسينات تم إضافتها

### ✅ تحسينات الـ Sidebar

- تقليل المجموعات من 9+ إلى 7 مجموعات
- دمج العناصر ذات الصلة
- أسماء أقصر وأوضح
- واجهة أنظف

### ✅ تحسينات الداشبورد

- معالجة البيانات الفارغة
- Fallback values
- تحسينات الأداء
- رسائل خطأ أوضح

### ✅ تحسينات الأداء

- Memoization للبيانات المتكررة
- التخزين المؤقت الذكي
- معالجة الأخطاء المحسّنة
- إعادة اتصال ذكية

---

## 🔍 التحقق من التحسينات

### فحص الـ Sidebar

```bash
# فتح الملف
open src/components/layout/Sidebar.tsx

# ابحث عن المجموعات الجديدة (7 فقط)
```

### فحص الداشبورد

```bash
# فتح الملف
open src/pages/ExecutiveDashboard2027.tsx

# اختبر عرض البيانات
```

### فحص الأداء

```bash
# استخدم Chrome DevTools
# Ctrl+Shift+I (أو Cmd+Option+I على Mac)

# اذهب إلى Performance tab
# انقر على Record
# تفاعل مع التطبيق
# انقر على Stop
```

---

## 📊 قياس الأداء

### استخدام Lighthouse

```bash
# تثبيت Lighthouse CLI
npm install -g @lhci/cli@0.9.x

# تشغيل الفحص
lhci autorun
```

### استخدام Chrome DevTools

```
1. افتح Chrome DevTools (F12)
2. اذهب إلى: Lighthouse tab
3. اختر Mobile/Desktop
4. انقر: Analyze page load
5. انتظر النتائج
```

---

## 🐛 استكشاف الأخطاء

### المشكلة: البيانات لا تظهر

```typescript
// تحقق من البيانات
console.log(state.summary);
console.log(state.dailySales);
console.log(state.monthlySales);

// استخدم ensureValidDashboardData
import { ensureValidDashboardData } from '@/lib/dashboard/dashboardOptimizations';
const validData = ensureValidDashboardData(state);
```

### المشكلة: الـ Sidebar بطيء

```typescript
// تحقق من عدد العناصر
console.log(GROUPS.length); // يجب أن يكون 7

// استخدم React DevTools للتحقق من re-renders
```

### المشكلة: استهلاك الذاكرة مرتفع

```typescript
// اختبر Cache
const cache = new PerformanceCache();
console.log(cache.size()); // عدد العناصر المخزنة

// وضح الذاكرة
cache.clear();
```

---

## 📚 قراءات إضافية

1. [IMPROVEMENTS_SUMMARY_2026.md](./IMPROVEMENTS_SUMMARY_2026.md)
   - ملخص التحسينات الشامل
   - شرح مفصل لكل تحسين

2. [BEST_PRACTICES_AR.md](./BEST_PRACTICES_AR.md)
   - أفضل الممارسات
   - أمثلة عملية
   - نصائح وحيل

3. [TESTING_CHECKLIST_AR.md](./TESTING_CHECKLIST_AR.md)
   - قائمة الاختبارات
   - خطوات الاختبار
   - نموذج التقرير

---

## 🎯 المساهمة

### قبل البدء بأي تطوير جديد

1. اقرأ [IMPROVEMENTS_SUMMARY_2026.md](./IMPROVEMENTS_SUMMARY_2026.md)
2. اقرأ [BEST_PRACTICES_AR.md](./BEST_PRACTICES_AR.md)
3. اتبع قائمة الاختبارات

### عند إضافة ميزة جديدة

```bash
# 1. إنشئ branch جديد
git checkout -b feature/your-feature-name

# 2. عمل التحسينات
# ...

# 3. الاختبار المحلي
npm run dev
npm run test

# 4. إنشاء Pull Request
git push origin feature/your-feature-name
```

---

## 🆘 الدعم الفني

### عند مواجهة مشاكل

1. تحقق من رسالة الخطأ في Console
2. ابحث في [TESTING_CHECKLIST_AR.md](./TESTING_CHECKLIST_AR.md)
3. اتصل بفريق الدعم

### معلومات مفيدة

- **الإصدار**: v2.1.0
- **آخر تحديث**: 2026-06-18
- **الحالة**: ✅ جاهز للإنتاج

---

## ✨ الخطوات التالية

- [ ] اقرأ ملخص التحسينات
- [ ] اختبر التطبيق محلياً
- [ ] استخدم أفضل الممارسات
- [ ] أرسل التعليقات والاقتراحات

---

**تم إعداده بواسطة**: فريق التطوير
**التاريخ**: 2026-06-18
**الحالة**: ✅ مكتمل وجاهز
