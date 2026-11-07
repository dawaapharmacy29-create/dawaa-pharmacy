import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, TriangleAlert } from 'lucide-react';

// Pages kept for the general manager to review before deciding what happens to each one. They are not in any
// other role's menu, and App.tsx refuses /review-pages for every other role before any of this code loads.
type ReviewPage = {
  slug: string;
  label: string;
  state: string;
  // Saving on this page changes live data.
  writes: boolean;
  component: LazyExoticComponent<ComponentType>;
};

export const REVIEW_PAGES: ReviewPage[] = [
  {
    slug: 'customer-cashback-base',
    label: 'الكاش باك (النسخة القديمة)',
    state: 'النسخة القديمة من صفحة الكاش باك. آخر حركة مسجلة في 22 أغسطس. بطيئة لأنها بتعرض آلاف الصفوف مرة واحدة.',
    writes: true,
    component: lazy(() => import('@/pages/CustomerCashbackBase')),
  },
  {
    slug: 'doctor-evaluation',
    label: 'تقييم الدكاترة في خدمة العملاء',
    state: 'بتعرض وتحفظ تقييم الدكتور. الاعتماد بيتحول لنقاط حقيقية.',
    writes: true,
    component: lazy(() => import('@/pages/CustomerServiceDoctorEvaluation')),
  },
  {
    slug: 'conversation-analyzer',
    label: 'محلل محادثات واتساب',
    state: 'بتحلل ملف محادثة ترفعه.',
    writes: false,
    component: lazy(() => import('@/pages/WhatsAppConversationAnalyzer')),
  },
  {
    slug: 'whatsapp-review-queue',
    label: 'قايمة مراجعة واتساب',
    state: 'فيها محادثتين بس لحد دلوقتي.',
    writes: false,
    component: lazy(() => import('@/pages/WhatsAppReviewQueueV4')),
  },
  {
    slug: 'whatsapp-followup-requests',
    label: 'طلبات المتابعة الآلية',
    state: 'جدولها فاضي، والسيرفر بيرفض طلب القايمة (401)، فمش هتظهر فيها طلبات.',
    writes: true,
    component: lazy(() => import('@/pages/WhatsAppAutoFollowupRequests')),
  },
  {
    slug: 'whatsapp-folder-watcher',
    label: 'المراقبة التلقائية للواتساب',
    state: 'محتاجة توصيل فولدر من الجهاز. لو الفولدر متوصل قبل كده، بتسحب منه لوحدها طول ما هي مفتوحة.',
    writes: true,
    component: lazy(() => import('@/pages/WhatsAppFolderWatcher')),
  },
  {
    slug: 'whatsapp-doctor-performance',
    label: 'أداء الدكاترة في الواتساب',
    state: 'تقرير للقراءة بس.',
    writes: false,
    component: lazy(() => import('@/pages/WhatsAppDoctorPerformance')),
  },
  {
    slug: 'whatsapp-customer-history',
    label: 'سجل محادثات العميل',
    state: 'فيها رسالة تحويل وروابط بس، مفيهاش بيانات.',
    writes: false,
    component: lazy(() => import('@/pages/WhatsAppCustomerHistory')),
  },
  {
    slug: 'whatsapp-lost-opportunities',
    label: 'الفرص الضائعة',
    state: 'فيها رسالة تحويل وروابط بس، مفيهاش بيانات.',
    writes: false,
    component: lazy(() => import('@/pages/WhatsAppLostOpportunities')),
  },
  {
    slug: 'whatsapp-branch-comparison',
    label: 'مقارنة الفروع (واتساب)',
    state: 'فيها رسالة تحويل وروابط بس، مفيهاش بيانات.',
    writes: false,
    component: lazy(() => import('@/pages/WhatsAppBranchComparison')),
  },
  {
    slug: 'customer-service-copy',
    label: 'خدمة العملاء (ملف تاني لنفس الصفحة)',
    state: 'نفس صفحة خدمة العملاء الشغالة بالظبط.',
    writes: true,
    component: lazy(() => import('@/pages/CustomerService')),
  },
  {
    slug: 'staff-payroll-copy',
    label: 'الرواتب (ملف تاني لنفس الصفحة)',
    state: 'نفس صفحة الرواتب الشغالة بالظبط.',
    writes: true,
    component: lazy(() => import('@/pages/StaffPayroll')),
  },
];

const LIVE_DATA_WARNING = 'أي حفظ في الصفحة دي بيتسجل على البيانات الحقيقية.';

export default function OwnerReviewPages() {
  const { slug } = useParams();

  if (!slug) {
    return (
      <div className="space-y-4 p-4" dir="rtl">
        <div>
          <h1 className="text-xl font-bold">صفحات للمراجعة</h1>
          <p className="dawaa-body text-sm">ظاهرة ليك إنت بس كمدير عام. الموظفين ومدراء الفروع مش شايفينها.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {REVIEW_PAGES.map((page) => (
            <Link key={page.slug} to={`/review-pages/${page.slug}`} className="dawaa-card block p-4">
              <div className="font-semibold">{page.label}</div>
              <div className="dawaa-body mt-1 text-sm">{page.state}</div>
              {page.writes ? <div className="mt-2 text-xs font-semibold text-amber-700">بتحفظ على البيانات الحقيقية</div> : null}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const page = REVIEW_PAGES.find((item) => item.slug === slug);
  const backLink = (
    <Link to="/review-pages" className="inline-flex items-center gap-1 text-sm font-semibold">
      <ArrowRight size={16} />
      كل صفحات المراجعة
    </Link>
  );

  if (!page) {
    return (
      <div className="space-y-3 p-4" dir="rtl">
        <p>الصفحة دي مش في قايمة المراجعة.</p>
        {backLink}
      </div>
    );
  }

  const Page = page.component;
  return (
    <div className="space-y-3">
      <div className="space-y-2 p-4 pb-0" dir="rtl">
        {backLink}
        {page.writes ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            <TriangleAlert size={16} />
            {LIVE_DATA_WARNING}
          </div>
        ) : null}
      </div>
      <Suspense fallback={<div className="dawaa-body py-16 text-center" dir="rtl">جاري تحميل {page.label}…</div>}>
        <Page />
      </Suspense>
    </div>
  );
}
