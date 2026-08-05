# صيدليات دواء - Dawaa Pharmacy

تطبيق ويب متكامل لإدارة العمليات في صيدليات دواء. يتيح النظام تتبع المخزون، إدارة المبيعات، ومتابعة العملاء والموظفين بكفاءة.

## التقنيات المستخدمة (Tech Stack)
- **Frontend:** React.js, TypeScript, TailwindCSS
- **Build Tool:** Vite
- **Backend & Database:** Supabase
- **Hosting:** Vercel

## متطلبات التشغيل (Prerequisites)
- Node.js (Version 18+)
- npm or yarn

## طريقة التشغيل (Setup Instructions)

1. **تثبيت الحزم المطلوبة:**
   ```bash
   npm install
   ```

2. **إعداد متغيرات البيئة:**
   قم بنسخ ملف `.env.example` إلى `.env` وأضف بيانات الاتصال بـ Supabase.

3. **تشغيل بيئة التطوير:**
   ```bash
   npm run dev
   ```

## هيكل المشروع (Project Structure)
- `src/`: ملفات الكود المصدري للمشروع (مكونات، صفحات، خطافات).
- `docs/`: ملفات التوثيق والتقارير.
- `supabase/`: إعدادات وملفات SQL الخاصة بقاعدة البيانات.
- `scripts/`: سكربتات مساعدة لمهام الصيانة والتطوير.

## الرابط المباشر
يمكنك تصفح الموقع الحي عبر الرابط: [https://dawaa-pharmacy.vercel.app](https://dawaa-pharmacy.vercel.app)
