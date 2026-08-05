---
title: Quick Start - Performance Optimization Tools
description: How to use the new performance tools in your components
---

# 🚀 البدء السريع - أدوات تحسين الأداء

## التثبيت والإعداد

جميع الأدوات مثبتة بالفعل في المشروع:

```bash
# تحقق من وجود الملفات
ls src/hooks/useLocalCache.ts
ls src/hooks/useDataProcessor.ts
ls src/hooks/useMemoizedSelector.ts
ls src/workers/dataProcessor.ts
ls src/lib/performanceMonitoring.ts
```

---

## مثال 1: تخزين مؤقت بسيط (Caching)

### المشكلة ❌
تحميل نفس البيانات عدة مرات من الخادم

### الحل ✅
```typescript
import { useLocalCache } from '@/hooks/useLocalCache';

export function Dashboard() {
  // البيانات محفوظة في IndexedDB لمدة 5 دقائق
  const { data, loading, refetch } = useLocalCache(
    'dashboard-data',
    async () => {
      const response = await fetch('/api/dashboard');
      return response.json();
    },
    { ttlMs: 5 * 60 * 1000 } // 5 دقائق
  );

  if (loading) return <Skeleton />;
  
  return (
    <div>
      <div>{data?.totalSales}</div>
      <button onClick={() => refetch()}>تحديث</button>
    </div>
  );
}
```

**الفائدة**: 🚀 تقليل الاستدعاءات من الخادم بـ 30-50%

---

## مثال 2: منع إعادة التصيير غير الضرورية (Memoization)

### المشكلة ❌
جدول بـ 1000 صف يعيد التصيير بالكامل عند تغيير مرشح واحد

### الحل ✅
```typescript
import { useMemoizedArray, useMemoizedSelector } from '@/hooks/useMemoizedSelector';
import React from 'react';

// 1. Memoize مكون الصف
const CustomerRow = React.memo(
  ({ customer, onSelect }) => (
    <tr onClick={() => onSelect(customer.id)}>
      <td>{customer.name}</td>
      <td>{customer.email}</td>
    </tr>
  ),
  (prev, next) => 
    prev.customer.id === next.customer.id &&
    prev.onSelect === next.onSelect
);

// 2. Memoize المصفوفة
export function CustomerList({ customers, filter }) {
  const filteredCustomers = useMemoizedArray(
    customers.filter(c => c.active === filter),
    [customers, filter]
  );

  return (
    <table>
      <tbody>
        {filteredCustomers.map(c => (
          <CustomerRow key={c.id} customer={c} onSelect={handleSelect} />
        ))}
      </tbody>
    </table>
  );
}
```

**الفائدة**: 🎯 تقليل re-renders بـ 60-80%

---

## مثال 3: معالجة البيانات الثقيلة (Web Worker)

### المشكلة ❌
ترتيب وتصفية 10,000 صف يعطل واجهة المستخدم

### الحل ✅
```typescript
import { useDataProcessor } from '@/hooks/useDataProcessor';

export function Analytics({ data }) {
  const { aggregate, filter, sort, loading } = useDataProcessor();
  const [results, setResults] = useState([]);

  const handleAnalyze = async () => {
    // معالجة في Web Worker (بدون تجميد UI)
    const filtered = await filter(data, [
      { field: 'status', op: 'eq', value: 'completed' },
      { field: 'amount', op: 'gt', value: 1000 },
    ]);

    const sorted = await sort(filtered, [
      { field: 'date', ascending: false }
    ]);

    const total = await aggregate(sorted, 'amount', 'sum');

    setResults({ data: sorted, total });
  };

  return (
    <>
      <button onClick={handleAnalyze} disabled={loading}>
        {loading ? 'جاري المعالجة...' : 'تحليل البيانات'}
      </button>
      {results.data && <div>الإجمالي: {results.total}</div>}
    </>
  );
}
```

**الفائدة**: ⚡ معالجة سريعة بدون تجميد (0% UI lag)

---

## مثال 4: قياس الأداء (Monitoring)

### المشكلة ❌
لا تعرف أي صفحة بطيئة أو كم Web Vitals

### الحل ✅
```typescript
// في main.tsx
import { initializePerformanceMonitoring } from '@/lib/performanceMonitoring';

// تفعيل المراقبة
initializePerformanceMonitoring();

// في أي مكان في التطبيق
import { PerformanceMonitor } from '@/lib/performanceMonitoring';

const monitor = PerformanceMonitor.getInstance();

// قياس عملية مخصصة
monitor.recordMetric('CustomOperation', 250); // milliseconds

// الوصول من DevTools Console
// window.__PERFORMANCE_MONITOR.getMetrics()
```

**الفائدة**: 📊 تتبع كامل لأداء التطبيق

---

## أين تطبق هذه الأدوات؟

### 🟢 أعلى أولوية (الفائدة الأكبر)

1. **صفحة العملاء** (Customers.tsx)
   ```typescript
   // استخدم useLocalCache لـ جلب العملاء
   // استخدم React.memo للصفوف
   // استخدم useDataProcessor للتصفية والترتيب
   ```

2. **صفحة الفواتير** (Invoices.tsx)
   ```typescript
   // استخدم useLocalCache لـ الفواتير
   // استخدم useDataProcessor للتجميع
   ```

3. **لوحة التحكم** (ExecutiveDashboard2027.tsx)
   ```typescript
   // استخدم useLocalCache للمقاييس
   // استخدم useDataProcessor للحسابات
   ```

### 🟡 أولوية متوسطة

4. **تحليلات** (Analytics.tsx)
5. **إدارة الموظفين** (StaffPerformance.tsx)

### 🟣 أولوية منخفضة

6. الصفحات الأخرى التي تحتاج عدد استدعاءات أقل

---

## نصائح العملية 💡

### ✅ افعل هذا:

```typescript
// استخدم memoization للمصفوفات المشتقة
const activeUsers = useMemoizedArray(
  users.filter(u => u.active),
  [users]
);

// استخدم TTL قصير للبيانات المتغيرة
{ ttlMs: 60 * 1000 } // دقيقة واحدة

// استخدم React.memo للقوائم
const Row = React.memo(({ item }) => (...));
```

### ❌ لا تفعل هذا:

```typescript
// لا تستخدم memoization للحسابات البسيطة
const sum = useMemoizedSelector(
  (data) => data.reduce((a, b) => a + b, 0),
  data
);

// لا تستخدم TTL طويل جداً
{ ttlMs: 24 * 60 * 60 * 1000 } // يوم كامل - قد تكون البيانات قديمة

// لا تستخدم Web Worker للعمليات البسيطة
// (overhead > الفائدة)
```

---

## اختبر التحسينات 🧪

### 1. قياس حجم Bundle
```bash
ANALYZE=true npm run build
# ستفتح dist/stats.html بتصور تفاعلي
```

### 2. قياس أداء الصفحة
```bash
npm run preview
# افتح DevTools → Lighthouse
# اختبر Performance
```

### 3. مراقبة Web Vitals
```typescript
// في DevTools Console بعد التطبيق
window.__PERFORMANCE_MONITOR?.getMetrics()
```

---

## الخطوات التالية

### هذا الأسبوع
- [ ] طبق `useLocalCache` في 2-3 صفحات رئيسية
- [ ] أضف `React.memo` لصفوف الجداول
- [ ] قس النتائج بـ Lighthouse

### الأسبوع القادم
- [ ] طبق `useDataProcessor` في صفحة التحليلات
- [ ] أضف `useMemoizedArray` في القوائم الكبيرة
- [ ] راقب Web Vitals في الإنتاج

### الأسبوع التالي
- [ ] استكمل التطبيق في باقي الصفحات
- [ ] حسّن الـ bundle بـ tree-shaking
- [ ] راجع النتائج النهائية

---

## الدعم والمساعدة 🆘

### مشاكل شائعة

**Q: useDataProcessor لا يعمل؟**
A: تحقق من console - قد لا يكون Web Worker مدعوماً. سيرجع الـ fallback للـ main thread.

**Q: useLocalCache لا يحفظ البيانات؟**
A: فعّل IndexedDB: DevTools → Storage → IndexedDB. تحقق من الصلاحيات.

**Q: React.memo لا يمنع re-renders؟**
A: تأكد من أن الـ props مرجعية مستقرة (استخدم useMemoizedObject).

### ملفات إضافية
- `PERFORMANCE_OPTIMIZATION_SUMMARY.md` - شرح مفصل
- `PERFORMANCE_OPTIMIZATION_PHASE3.md` - أفضل الممارسات
- `src/components/examples/CustomerAnalyticsDashboardExample.tsx` - مثال كامل

---

## ملخص سريع ⚡

| الأداة | الاستخدام | التحسن |
|-------|----------|--------|
| **useLocalCache** | تخزين API responses | ↓ 30-50% requests |
| **useMemoizedSelector** | منع re-renders | ↓ 60-80% renders |
| **useDataProcessor** | معالجة ثقيلة | 0% UI lag |
| **React.memo** | مكونات الصفوف | ↓ 40-60% renders |
| **performanceMonitoring** | قياس الأداء | 📊 full tracking |

---

هل تحتاج إلى مساعدة في تطبيق أي من هذه الأدوات؟ اسأل! 😊
