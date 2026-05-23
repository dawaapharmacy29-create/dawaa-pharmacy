# خطة تنفيذ نظام النقاط والمكافآت والتحليلات
# Implementation Plan - Pharma Management System Enhancement

**التاريخ:** 2026-05-16
**الحالة:** تحليل وتخطيط شامل

---

## 📋 ملخص المتطلبات

هذا المشروع يتطلب تطويراً كاملاً لـ 12 وحدة رئيسية:

1. **نظام النقاط والمكافآت** - قواعد شاملة وتقييم تلقائي
2. **تقييم المحادثات** - نموذج تقييم متقدم (100 درجة)
3. **نظام التوصيل** - تقييم الدليفري بدلاً من الإدارة اليدوية
4. **البحث المتقدم** - بحث في قاعدة بيانات العملاء
5. **التحليلات والمبيعات** - مربوط بفواتير البيع اليومية
6. **استيراد الفواتير** - Preview + Mapping + التحقق من التكرار
7. **سجل الأنشطة** - Audit Trail شامل
8. **جداول وأعمدة جديدة** - Migrations مقترحة

---

## 🗂️ الجداول والأعمدة المقترحة

### 1. جدول `evaluation_rules` (جديد)
```sql
CREATE TABLE evaluation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL, -- "الانضباط", "خدمة العملاء", إلخ
  title TEXT NOT NULL,
  description TEXT,
  default_points INTEGER NOT NULL,
  type TEXT NOT NULL, -- "deduction" / "bonus"
  severity TEXT NOT NULL, -- "low" / "medium" / "high" / "critical"
  role_scope TEXT[] NOT NULL, -- ["doctor", "assistant", "all", ...]
  requires_approval BOOLEAN DEFAULT FALSE,
  evidence_required BOOLEAN DEFAULT FALSE,
  allowed_approver_roles TEXT[] DEFAULT ARRAY['branch_manager', 'general_manager'],
  repeat_policy TEXT, -- "multiply" / "accumulate" / "cap"
  max_points_cap INTEGER,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 2. تحديث جدول `points_transactions` (إضافة أعمدة)
```sql
ALTER TABLE point_records ADD COLUMN (
  base_points INTEGER,
  repeat_count INTEGER DEFAULT 0,
  multiplier NUMERIC DEFAULT 1.0,
  final_points INTEGER,
  applied_by_id UUID,
  applied_by_role TEXT,
  approved_by_id UUID,
  approved_by_role TEXT,
  approver_required_role TEXT,
  status TEXT DEFAULT 'pending', -- "pending" / "approved" / "rejected"
  source_module TEXT, -- "conversation_review" / "delivery" / "invoice_error" / etc
  source_record_id UUID NULLABLE,
  evidence_url TEXT NULLABLE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. جدول `conversation_reviews` (جديد)
```sql
CREATE TABLE conversation_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id UUID NOT NULL,
  reviewer_role TEXT NOT NULL,
  staff_id UUID NOT NULL,
  staff_role TEXT NOT NULL,
  customer_id UUID,
  review_type TEXT NOT NULL, -- "whatsapp" / "call" / "in_branch" / etc
  invoice_id TEXT,
  review_reason TEXT NOT NULL,
  
  -- Scoring Fields (8 dimensions, total 100)
  score_response_speed INTEGER, -- 10
  score_understanding INTEGER, -- 15
  score_professionalism INTEGER, -- 15
  score_accuracy INTEGER, -- 20
  score_sales_quality INTEGER, -- 15
  score_customer_coding INTEGER, -- 10
  score_closure INTEGER, -- 10
  score_satisfaction INTEGER, -- 5
  
  total_score INTEGER,
  has_complaint BOOLEAN DEFAULT FALSE,
  has_medical_error BOOLEAN DEFAULT FALSE,
  has_invoice_error BOOLEAN DEFAULT FALSE,
  reviewer_notes TEXT,
  training_recommendation TEXT,
  point_impact INTEGER,
  
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 4. جدول `sales_imports` (جديد)
```sql
CREATE TABLE sales_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_date DATE NOT NULL,
  branch_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  total_invoices INTEGER,
  new_invoices INTEGER,
  duplicate_invoices INTEGER,
  total_sales NUMERIC,
  imported_by UUID NOT NULL,
  status TEXT DEFAULT 'completed',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 5. جدول `activity_audit_log` (جديد)
```sql
CREATE TABLE activity_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  target_type TEXT,
  target_id UUID NULLABLE,
  target_name TEXT NULLABLE,
  details JSONB,
  branch_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🎯 خطة التنفيذ المرحلية

### **المرحلة 1: البنية الأساسية والجداول** (1-2 يوم)
- [ ] إنشاء Migrations للجداول الجديدة
- [ ] تحديث Types/Interfaces في TypeScript
- [ ] إنشاء Hooks للاستعلام من Supabase
- [ ] إضافة Helper functions للحسابات

### **المرحلة 2: نظام النقاط والمكافآت المحسّن** (2-3 أيام)
- [ ] تطوير صفحة إدارة قواعد النقاط
- [ ] تطبيق منطق مضاعفة الخصم (Repeat Multiplier)
- [ ] واجهة تقديم الخصومات مع الموافقات
- [ ] لوحة المدير للخصومات المعلقة

### **المرحلة 3: تقييم المحادثات** (2-3 أيام)
- [ ] نموذج التقييم (8 أبعاد × 100 درجة)
- [ ] حساب تأثير النقاط التلقائي
- [ ] دمج مع نظام المكافآت
- [ ] تقارير تقييم الموظفين

### **المرحلة 4: نظام البحث المتقدم** (1 يوم)
- [ ] بحث العملاء بأولويات (كود > اسم > هاتف)
- [ ] دعم البحث بـ Wildcards (*)
- [ ] Debounce للأداء

### **المرحلة 5: التوصيل والدليفري** (1-2 يوم)
- [ ] إعادة تصميم صفحة التوصيل
- [ ] ربط مع بيانات المبيعات
- [ ] نموذج تقييم الدليفري
- [ ] حساب النقاط التلقائي

### **المرحلة 6: الفواتير والمبيعات** (2-3 أيام)
- [ ] نموذج استيراد الفواتير
- [ ] Preview + Mapping
- [ ] كشف التكرار والأخطاء
- [ ] تحديث بيانات العملاء التلقائي

### **المرحلة 7: التحليلات الشاملة** (2 يوم)
- [ ] لوحة التحليلات الرئيسية
- [ ] تقارير الموظفين
- [ ] تقارير الشيفتات
- [ ] تقارير العملاء

### **المرحلة 8: سجل الأنشطة** (1 يوم)
- [ ] Audit Trail شامل
- [ ] نموذج البحث والفلترة
- [ ] تقارير الأنشطة

### **المرحلة 9: الاختبار والبناء** (1 يوم)
- [ ] اختبار شامل
- [ ] `npm run build`
- [ ] إصلاح الأخطاء

---

## 💾 قواعد النقاط الكاملة

### **1. الانضباط والحضور**
| القاعدة | النقاط | النوع |
|--------|--------|-------|
| تأخير < 10 دقائق | -5 | خصم |
| تأخير 10-30 دقيقة | -15 | خصم |
| تأخير > 30 دقيقة | -30 | خصم |
| غياب بدون إذن | -80 | خصم |
| انصراف مبكر | -25 | خصم |
| عدم تسجيل حضور | -10 | خصم |
| تكرار التأخير (3×) | -20 | خصم |

### **2. خدمة العملاء**
| القاعدة | النقاط | النوع |
|--------|--------|-------|
| تأخير بدء الخدمة | -10 | خصم |
| عدم الترحيب | -5 | خصم |
| عدم فهم الطلب | -10 | خصم |
| عدم شرح الجرعة | -25 | خصم |
| تكويد عميل جديد | +5 | مكافأة |
| استرجاع عميل | +20 | مكافأة |
| إشادة عميل | +15 | مكافأة |

### **3. دقة الفواتير**
| القاعدة | النقاط | النوع |
|--------|--------|-------|
| خطأ بسيط | -20 | خصم |
| خطأ في صنف | -30 | خصم |
| خطأ جرعة | -60 | خصم |
| اكتشاف خطأ مبكراً | +10 | مكافأة |

---

## 🔄 منطق مضاعفة الخصم (Repeat Multiplier)

**المعادلة:**
```
finalPoints = basePoints × 2^(repeatCount)

حيث:
- repeatCount = عدد مرات نفس الخطأ السابقة
- في نفس الدورة الشهرية (26-25)
- لنفس الموظف ونفس rule_code
```

**أمثلة:**
- المرة الأولى: 20 نقطة
- المرة الثانية: 40 نقطة (20 × 2^1)
- المرة الثالثة: 80 نقطة (20 × 2^2)
- المرة الرابعة: 160 نقطة (مع حد أقصى)

---

## 📊 تحويل درجة المحادثة إلى نقاط

```
100%        → +6 نقاط
95-99       → +5 نقاط
90-94       → +3 نقاط
80-89       → 0 نقطة (محايد)
70-79       → -3 نقاط
60-69       → -6 نقاط
< 60        → -10 نقاط
< 50 + خطأ   → -20 نقطة (مراجعة جودة)
```

**شروط:**
- إذا `has_medical_error = true` → لا مكافآت
- إذا `has_complaint = true` → لا مكافآت
- إذا `has_medical_error = true` → يحتاج مدير جودة

---

## 🔐 صلاحيات الاعتماد

```
خصم بسيط (low)         → مدير الفرع
خصم متوسط (medium)     → مدير الفرع + مدير عام
خصم أو خطأ جودة (high) → مدير عام + مدير جودة
خطأ دوائي (critical)   → مدير الجودة + مدير عام
```

---

## 🛠️ أدوات وتقنيات

- **Frontend:** React 18 + TypeScript + Tailwind CSS
- **Backend:** Supabase (PostgreSQL)
- **الحالة:** Zustand/Redux
- **المكتبات:** React Query, react-hook-form, zod
- **البحث:** Supabase FTS (Full Text Search)
- **الاستيراد:** xlsx للملفات

---

## ⚠️ ملاحظات مهمة

1. **لا تحذف صفحات موجودة** - الحفاظ على التوافق الكامل
2. **لا تستخدم service_role** - استخدم user-authenticated client فقط
3. **لا تضع مفاتيح في الكود** - استخدم environment variables
4. **أنشئ Migrations فقط** - لا تشغّل يدويًا
5. **RTL + Mobile First** - كل شيء عربي وموبايل أولاً
6. **Build Test:** `npm run build` يجب أن ينجح بدون أخطاء

---

## 📝 الخطوات التالية

1. تأكيد الموافقة على خطة التنفيذ
2. إنشاء Migrations SQL
3. بدء الم��حلة 1
4. اختبار شامل في كل مرحلة
5. Build نهائي وتصحيح أخطاء

---

**تم إنشاء هذا التقرير:** 2026-05-16
**حالة المشروع:** جاهز للتنفيذ

