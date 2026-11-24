import { Children, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { PageSectionsPreview } from '@/components/security/PermissionGate';
import { NavigationGuardProvider } from '@/contexts/NavigationGuardContext';
import BranchTargetEditor from '@/components/dashboard/BranchTargetEditor';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { assistantHomePath } from '@/lib/navigation/assistantHome';

const ReviewsInsightsHub = lazy(() => import('@/components/reviews/ReviewsInsightsHub'));

const PAGE_TITLES: Record<string, string> = {
  '/': 'لوحة القيادة 2027',
  '/dr-wael-fingerprints': 'بصمات د وائل',
  '/dr-wael-shokry-reports': 'تقارير شكري',
  '/customers': 'إدارة العملاء',
  '/customer-service': 'مركز خدمة العملاء',
  '/customer-data-review': 'مراجعة بيانات العملاء',
  '/customer-welcome': 'الرسائل الترحيبية',
  '/welcome-messages': 'الرسائل الترحيبية',
  '/quick-replies': 'اختصارات الردود السريعة',
  '/doctor-competition': 'مسابقة الدكاترة',
  '/customer-cashback': 'نقاط العملاء / الكاش باك',
  '/customer-service-credit': 'كريديت خدمة العملاء',
  '/customer-requests': 'طلبات العملاء',
  '/review-pages': 'صفحات للمراجعة',
  '/team': 'إدارة الفريق',
  '/schedule': 'الجدول الأسبوعي',
  '/time-off': 'الإذونات والإجازات',
  '/points': 'النقاط والمكافآت',
  '/reviews': 'تقييم المحادثات',
  '/shift-performance': 'تقييم الشيفتات',
  '/doctor-dashboard': 'لوحة الدكتور',
  '/stagnant-medicines': 'الأدوية الرواكد',
  '/incentive-medicines': 'أدوية اللستة',
  '/delivery': 'التوصيل وتقييم الدليفري',
  '/analytics': 'التحليلات والمبيعات',
  '/invoices': 'استيراد الفواتير',
  '/staff-accounts': 'حسابات الفريق',
  '/roles-permissions': 'الأدوار والصلاحيات',
  '/activity-log': 'سجل الأنشطة',
  '/penalty-incentive': 'الجزاءات والمكافآت',
  '/evaluation-rules': 'قواعد التقييم المرنة',
  '/quarterly-incentives': 'نظام وقواعد الحافز',
  '/operations-center': 'المهام والتنبيهات',
  '/staff-dashboard': 'لوحة تحكم الموظف',
  '/medicine-expiry': 'متابعة صلاحية الأدوية',
  '/attendance-report': 'مركز الحضور',
  '/loyalty-tiers': 'مستويات ولاء العملاء',
  '/customer-service-tasks': 'شيت مهام اليوم',
  '/assistant-operational-log': 'تسجيل المشتريات وخدمة العملاء',
  '/my-daily-checklist': 'التشيك ليست اليومي',
  '/pharmacy-zone-tasks': 'الرص والجرد اليومي',
  '/purchases': 'المشتريات',
  '/purchase-invoice-entry': 'تسجيل فاتورة مشتريات',
};

const TEAM_DAWAA_ASSISTANT_NAMES = new Set(['هاجر', 'نور', 'هبه محمد', 'هبة محمد']);
// صفحات فريق خدمة العملاء (هاجر/نور/هبه). أي صفحة برّه القايمة دي بترجعهم لصفحة البداية،
// فأي صفحة جديدة ليهم لازم تتضاف هنا كمان مش في القايمة الجانبية بس.
// (صاحب الصيدلية 2026-11-24: شغلهم المسابقة وتسجيل الفواتير وخدمة العملاء؛ مركز خدمة العملاء القديم،
// قاعدة العملاء، قايمة المشتريات وصفحات الإدارة برّه القايمة دي.)
const TEAM_DAWAA_ASSISTANT_ALLOWED_PATHS = new Set([
  // خدمة العملاء والمسابقة
  '/customer-service-tasks',
  '/customer-requests',
  '/reviews',
  '/customer-coding',
  '/quick-replies',
  '/welcome-messages',
  '/customer-points-ledger',
  // تسجيل الفواتير
  '/purchase-invoice-entry',
  '/purchase-invoice-accuracy',
  // يومهم وحسابهم
  '/my-daily-checklist',
  '/assistant-operational-log',
  '/schedule',
  '/points',
]);
const TEAM_DAWAA_ALPHA_ROLE = 'team_dawaa_alpha';

function normalizeAssistantName(value: unknown) {
  return String(value ?? '')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function LayoutRuntime({ children }: { children: React.ReactNode }) {
  const { user, checkPermission } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'صيدليات دواء';
  const mainRef = useRef<HTMLElement>(null);
  const hasChildren = Children.count(children) > 0;
  const showTargetEditor = location.pathname === '/';
  const reviewParams = new URLSearchParams(location.search);
  const reviewsPageMode = reviewParams.get('mode');
  const reviewsPageSection = reviewParams.get('section');
  const reviewsPageId = reviewParams.get('id');
  // تحليلات التقييمات (تقرير أداء الدكاترة، تحليل الفرعين، التصدير) للإدارة؛ المساعد بيضيف تقييمات بس.
  const showReviewsHub =
    location.pathname === '/reviews' &&
    normalizeRole(user?.role) !== 'assistant' &&
    reviewsPageMode !== 'new' &&
    reviewsPageSection !== 'history' &&
    !reviewsPageId;

  // الفريق بيتعرف من دور الحساب (team_dawaa_alpha)، والاسم احتياطي بس: تغيير اسم العرض مايفتحش الحصر.
  const isScopedAssistant =
    normalizeRole(user?.role) === 'assistant' &&
    (String(user?.rawRole || '').trim().toLowerCase() === TEAM_DAWAA_ALPHA_ROLE ||
      TEAM_DAWAA_ASSISTANT_NAMES.has(normalizeAssistantName(user?.name)));
  const assistantPathAllowed = TEAM_DAWAA_ASSISTANT_ALLOWED_PATHS.has(location.pathname);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'dawaa_invoice_import_refresh' || !event.newValue) return;
      window.dispatchEvent(
        new CustomEvent('dawaa:data-refresh', { detail: { source: 'invoice-import' } })
      );
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const key = `dawaa_scroll_${location.pathname}${location.search}`;
    const main = mainRef.current;
    if (!main) return;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      requestAnimationFrame(() => {
        main.scrollTop = Number(saved) || 0;
      });
    } else {
      main.scrollTop = 0;
    }
    const saveScroll = () => sessionStorage.setItem(key, String(main.scrollTop));
    main.addEventListener('scroll', saveScroll, { passive: true });
    return () => {
      saveScroll();
      main.removeEventListener('scroll', saveScroll);
    };
  }, [location.pathname, location.search]);

  if (isScopedAssistant && !assistantPathAllowed) {
    return <Navigate to={assistantHomePath(checkPermission)} replace />;
  }

  return (
    <NavigationGuardProvider>
      <div className="dawaa-app-bg flex h-screen overflow-hidden" dir="rtl">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative z-[220] shrink-0">
            <Header onMobileMenuOpen={() => setMobileOpen(true)} title={title} />
          </div>
          <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            <div className="animate-fade-in mx-auto min-h-[calc(100vh-120px)] max-w-[1720px] space-y-4">
              <PageSectionsPreview path={location.pathname} />
              {showTargetEditor ? <BranchTargetEditor compact /> : null}
              {showReviewsHub ? (
                <Suspense fallback={<div className="dawaa-card p-4 text-sm text-[var(--dawaa-theme-muted)]">جاري تحميل تحليلات التقييمات…</div>}>
                  <ReviewsInsightsHub />
                </Suspense>
              ) : null}
              {hasChildren ? (
                children
              ) : (
                <section className="dawaa-card dawaa-alert--warning text-center">
                  <div className="w-full">
                    <h1 className="dawaa-title text-xl">لم يتم تحميل محتوى الصفحة</h1>
                    <p className="dawaa-caption mt-2">
                      الصفحة فتحت لكن لم يصل محتوى قابل للعرض. افتح التشخيص لمعرفة آخر خطأ تشغيل.
                    </p>
                    <Link to="/diagnostics" className="dawaa-button dawaa-button--primary mt-4">
                      فتح التشخيص
                    </Link>
                  </div>
                </section>
              )}
            </div>
          </main>
        </div>
      </div>
    </NavigationGuardProvider>
  );
}
