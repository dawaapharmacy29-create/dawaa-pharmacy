import CustomerMasterQualityCenter from '@/components/customers/CustomerMasterQualityCenter';
import CustomerDataReviewLegacy from '@/pages/CustomerDataReviewLegacy';

export default function CustomerDataReview() {
  return (
    <div dir="rtl" className="space-y-8">
      <CustomerMasterQualityCenter />
      <section className="space-y-3">
        <div className="px-1">
          <h2 className="text-xl font-black text-slate-900">مراجعات الفروع والمتابعات</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">
            الأدوات السابقة محفوظة بالكامل أسفل مركز جودة ملف العملاء الرئيسي.
          </p>
        </div>
        <CustomerDataReviewLegacy />
      </section>
    </div>
  );
}
