import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { isIOSWebKit } from '@/lib/mobileSafariCompat';
import { Toaster } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getRoutePermissions } from '@/lib/core/permissionSystem';
import Layout from '@/components/layout/Layout';
import PWABanner from '@/components/features/PWABanner';
import { isDoctorRole } from '@/lib/security/userDataScope';
import AppRecoveryScreen from '@/components/system/AppRecoveryScreen';
import { diagnosticsUrl, logRuntimeError, loginRecoveryUrl } from '@/lib/appRecovery';
import PageSafetyBoundary from '@/components/system/PageSafetyBoundary';
import AppHealthBanner from '@/components/system/AppHealthBanner';
import ExecutiveDashboardRoute from '@/pages/ExecutiveDashboardRoute';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const Login = lazy(() => import('@/pages/Login'));
const BranchComparison = lazy(() => import('@/pages/BranchComparison'));
const BranchInspection = lazy(() => import('@/pages/BranchInspection'));
const EvaluationRules2027 = lazy(() => import('@/pages/EvaluationRules2027'));
const QuarterlyIncentives2027 = lazy(() => import('@/pages/QuarterlyIncentives2027'));
const OperationsCenter2027 = lazy(() => import('@/pages/OperationsCenter2027'));
const DataHealthCenter = lazy(() => import('@/pages/DataHealthCenter'));
const Customers = lazy(() => import('@/pages/Customers'));
const Customer360 = lazy(() => import('@/pages/Customer360'));
const CustomerImport = lazy(() => import('@/pages/CustomerImport'));
const CustomerService = lazy(() => import('@/pages/SmartCustomerService'));
const CustomerServiceClassic = lazy(() => import('@/pages/CustomerService'));
const CustomerRequests = lazy(() => import('@/pages/CustomerRequests'));
const CustomerIncubation = lazy(() => import('@/pages/CustomerIncubation'));
const CustomerDataReview = lazy(() => import('@/pages/CustomerDataReview'));
const CRMPage = lazy(() => import('@/pages/CRMPage'));
const CustomerCashback = lazy(() => import('@/pages/CustomerCashback'));
const CustomerServiceCredit = lazy(() => import('@/pages/CustomerServiceCredit'));
const CustomerPointsLedger = lazy(() => import('@/pages/CustomerPointsLedger'));
const WelcomeMessages = lazy(() => import('@/pages/WelcomeMessages'));
const CustomerWelcome = lazy(() => import('@/pages/CustomerWelcome'));
const CustomerCoding = lazy(() => import('@/pages/CustomerCoding'));
const QuickReplies = lazy(() => import('@/pages/QuickReplies'));
const DoctorCompetition = lazy(() => import('@/pages/DoctorCompetition'));
const Team = lazy(() => import('@/pages/Team'));
const Schedule = lazy(() => import('@/pages/Schedule'));
const Points = lazy(() => import('@/pages/Points'));
const Delivery = lazy(() => import('@/pages/Delivery'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const Invoices = lazy(() => import('@/pages/Invoices'));
const ActivityLog = lazy(() => import('@/pages/ActivityLog'));
const Reviews = lazy(() => import('@/pages/Reviews'));
const ShiftPerformance = lazy(() => import('@/pages/ShiftPerformance'));
const ShiftNotes = lazy(() => import('@/pages/ShiftNotes'));
const StaffDetail = lazy(() => import('@/pages/StaffDetail'));
const TimeOff = lazy(() => import('@/pages/TimeOff'));
const DoctorDashboard = lazy(() => import('@/pages/DoctorDashboardStable'));
const StagnantMedicines = lazy(() => import('@/pages/StagnantMedicines'));
const IncentiveMedicines = lazy(() => import('@/pages/IncentiveMedicines'));
const StaffAccounts = lazy(() => import('@/pages/StaffAccounts'));
const StaffDuplicateAudit = lazy(() => import('@/pages/StaffDuplicateAudit'));
const PenaltyIncentiveManagement = lazy(() => import('@/pages/PenaltyIncentiveManagement'));
const StaffDashboard = lazy(() => import('@/pages/StaffDashboard'));
const RolesPermissions = lazy(() => import('@/pages/RolesPermissions'));
const ShelfOrganization = lazy(() => import('@/pages/ShelfOrganization'));
const BranchCleaning = lazy(() => import('@/pages/BranchCleaning'));
const InventoryCounts = lazy(() => import('@/pages/InventoryCounts'));
const Shortages = lazy(() => import('@/pages/Shortages'));
const Supplies = lazy(() => import('@/pages/Supplies'));
const Purchases = lazy(() => import('@/pages/Purchases'));
const StaffPayroll = lazy(() => import('@/pages/StaffPayroll'));
const Accessories = lazy(() => import('@/pages/Accessories'));
const Offers = lazy(() => import('@/pages/Offers'));
const Stories = lazy(() => import('@/pages/Stories'));
const Training = lazy(() => import('@/pages/Training'));
const WhatsappAnalytics = lazy(() => import('@/pages/WhatsappAnalytics'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const MedicineExpiryTracker = lazy(() => import('@/pages/MedicineExpiryTracker'));
const AttendanceReport = lazy(() => import('@/pages/AttendanceReport'));
const LoyaltyTiers = lazy(() => import('@/pages/LoyaltyTiers'));
const DailyCommand = lazy(() => import('@/pages/DailyCommand'));
const DailyTarget = lazy(() => import('@/pages/DailyTarget'));
const TodayBrief = lazy(() => import('@/pages/TodayBrief'));
const RefillReminders = lazy(() => import('@/pages/RefillReminders'));
const CustomerHealthProfile = lazy(() => import('@/pages/CustomerHealthProfile'));
const ExpiryDiscounts = lazy(() => import('@/pages/ExpiryDiscounts'));
const EmployeeKpi = lazy(() => import('@/pages/EmployeeKpi'));
const EmployeeOperatingSystem = lazy(() => import('@/pages/EmployeeOperatingSystem'));
const SupplierPerformance = lazy(() => import('@/pages/SupplierPerformance'));
const ReportsCenter = lazy(() => import('@/pages/ReportsCenter'));
const StockAlerts = lazy(() => import('@/pages/StockAlerts'));
const Returns = lazy(() => import('@/pages/Returns'));
const Diagnostics = lazy(() => import('@/pages/Diagnostics'));

// Route permissions are centralized in src/lib/core/permissionSystem.ts

function PageLoadingFallback({ pageName }: { pageName: string }) {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => setIsSlow(true), 8000);
    return () => window.clearTimeout(timerId);
  }, []);

  if (isSlow) {
    return (
      <div className="rounded-3xl border border-amber-400/25 bg-slate-900 p-6 text-center text-slate-200 shadow-xl" dir="rtl">
        <div className="text-4xl">⚠️</div>
        <h2 className="mt-3 text-xl font-black text-white">تعذر تحميل {pageName}</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">
          استغرق تحميل هذه الصفحة أكثر من المعتاد. التطبيق ما زال يعمل، ويمكنك فتح التشخيص أو تسجيل الدخول من جديد.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={() => window.location.reload()}
            className="rounded-2xl bg-teal-600 px-5 py-3 text-sm font-black text-white hover:bg-teal-500"
          >
            إعادة المحاولة
          </button>
          <a
            href={diagnosticsUrl('route_slow_loading')}
            className="rounded-2xl border border-slate-700 px-5 py-3 text-sm font-black text-slate-200 hover:bg-slate-800"
          >
            فتح التشخيص
          </a>
          <a
            href={loginRecoveryUrl('route_slow_loading')}
            className="rounded-2xl border border-teal-400/40 px-5 py-3 text-sm font-black text-teal-100 hover:bg-teal-400/10"
          >
            تسجيل الدخول
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-slate-200" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-teal-500/20 border-t-teal-400" />
        <div className="text-sm font-black text-slate-300">جاري تحميل {pageName}...</div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-800/80" />
        ))}
      </div>
    </div>
  );
}

function routeSuspense(component: ReactNode, pageName: string) {
  return <Suspense fallback={<PageLoadingFallback pageName={pageName} />}>{component}</Suspense>;
}

function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, loading, checkPermission } = useAuth();
  const location = useLocation();
  const effectivePermissions = permission || getRoutePermissions(location.pathname);

  if (loading) return <PageLoadingFallback pageName="بيانات الدخول" />;
  if (!user) return <Navigate to="/login" replace />;

  if (location.pathname === '/' && isDoctorRole(user) && !checkPermission('view_executive_dashboard')) {
    return <Navigate to="/doctor-dashboard" replace />;
  }

  if (
    effectivePermissions &&
    (Array.isArray(effectivePermissions)
      ? !effectivePermissions.some((permission) => checkPermission(permission))
      : !checkPermission(effectivePermissions))
  ) {
    return (
      <Layout>
        <div className="stat-card text-center text-slate-300 py-16" dir="rtl">
          ليس لديك صلاحية للوصول إلى هذه الصفحة.
        </div>
      </Layout>
    );
  }

  return <Layout>{children}</Layout>;
}

function AdminRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { isAdmin, checkPermission } = useAuth();
  if (!isAdmin && (!permission || !checkPermission(permission))) {
    return (
      <div className="stat-card text-center text-slate-300 py-16" dir="rtl">
        ليس لديك صلاحية للوصول إلى هذه الصفحة.
      </div>
    );
  }
  return <>{children}</>;
}

type ErrorBoundaryState = { hasError: boolean; message?: string; isIOS?: boolean };

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, isIOS: false };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error?.message || 'unknown error',
      isIOS: isIOSWebKit(),
    };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('App error boundary caught error:', error, info);
    logRuntimeError('App error boundary caught error', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6" dir="rtl">
          <div className="rounded-3xl border border-red-500/20 bg-slate-900 p-8 text-center text-slate-200 shadow-2xl max-w-md w-full">
            <div className="mb-4 text-5xl">⚠️</div>
            <h1 className="text-2xl font-black text-white">حدث خطأ غير متوقع</h1>
            <p className="mt-3 text-sm text-slate-400 leading-relaxed">
              تم منع الصفحة من إيقاف التطبيق بالكامل. يمكنك إعادة المحاولة أو فتح شاشة الاستعادة.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button onClick={() => window.location.reload()} className="rounded-2xl bg-teal-600 px-5 py-3 font-black text-white">
                إعادة تحميل التطبيق
              </button>
              <a href={diagnosticsUrl('app_error_boundary')} className="rounded-2xl border border-slate-700 px-5 py-3 font-black text-slate-200">
                فتح التشخيص
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={routeSuspense(<Login />, 'تسجيل الدخول')} />
      <Route path="/" element={<ProtectedRoute><ExecutiveDashboardRoute /></ProtectedRoute>} />
      <Route path="/executive-2027" element={<ProtectedRoute>{routeSuspense(<ExecutiveDashboardRoute />, 'لوحة القيادة')}</ProtectedRoute>} />
      <Route path="/doctor-dashboard" element={<ProtectedRoute>{routeSuspense(<DoctorDashboard />, 'لوحة الدكتور')}</ProtectedRoute>} />
      <Route path="/branch-comparison" element={<ProtectedRoute>{routeSuspense(<BranchComparison />, 'مقارنة الفروع')}</ProtectedRoute>} />
      <Route path="/branch-inspection" element={<ProtectedRoute>{routeSuspense(<BranchInspection />, 'مرور مدير الفروع')}</ProtectedRoute>} />
      <Route path="/evaluation-rules" element={<ProtectedRoute>{routeSuspense(<EvaluationRules2027 />, 'قواعد التقييم')}</ProtectedRoute>} />
      <Route path="/quarterly-incentives" element={<ProtectedRoute>{routeSuspense(<QuarterlyIncentives2027 />, 'الحافز الشهري')}</ProtectedRoute>} />
      <Route path="/operations-center" element={<ProtectedRoute>{routeSuspense(<OperationsCenter2027 />, 'مركز العمليات')}</ProtectedRoute>} />
      <Route path="/data-health" element={<ProtectedRoute>{routeSuspense(<DataHealthCenter />, 'صحة البيانات')}</ProtectedRoute>} />
      <Route path="/customers" element={<ProtectedRoute>{routeSuspense(<Customers />, 'العملاء')}</ProtectedRoute>} />
      <Route path="/customers/:id" element={<ProtectedRoute>{routeSuspense(<Customer360 />, 'ملف العميل')}</ProtectedRoute>} />
      <Route path="/customer-import" element={<ProtectedRoute>{routeSuspense(<CustomerImport />, 'استيراد العملاء')}</ProtectedRoute>} />
      <Route path="/customer-service" element={<ProtectedRoute>{routeSuspense(<CustomerService />, 'خدمة العملاء')}</ProtectedRoute>} />
      <Route path="/customer-service-classic" element={<ProtectedRoute>{routeSuspense(<CustomerServiceClassic />, 'خدمة العملاء الكلاسيكية')}</ProtectedRoute>} />
      <Route path="/customer-requests" element={<ProtectedRoute>{routeSuspense(<CustomerRequests />, 'طلبات العملاء')}</ProtectedRoute>} />
      <Route path="/customer-incubation" element={<ProtectedRoute>{routeSuspense(<CustomerIncubation />, 'احتضان العملاء')}</ProtectedRoute>} />
      <Route path="/customer-data-review" element={<ProtectedRoute>{routeSuspense(<CustomerDataReview />, 'مراجعة بيانات العملاء')}</ProtectedRoute>} />
      <Route path="/crm" element={<ProtectedRoute>{routeSuspense(<CRMPage />, 'CRM')}</ProtectedRoute>} />
      <Route path="/customer-cashback" element={<ProtectedRoute>{routeSuspense(<CustomerCashback />, 'كاش باك العملاء')}</ProtectedRoute>} />
      <Route path="/customer-service-credit" element={<ProtectedRoute>{routeSuspense(<CustomerServiceCredit />, 'رصيد خدمة العملاء')}</ProtectedRoute>} />
      <Route path="/customer-points-ledger" element={<ProtectedRoute>{routeSuspense(<CustomerPointsLedger />, 'سجل نقاط العملاء')}</ProtectedRoute>} />
      <Route path="/welcome-messages" element={<ProtectedRoute>{routeSuspense(<WelcomeMessages />, 'رسائل الترحيب')}</ProtectedRoute>} />
      <Route path="/customer-welcome" element={<ProtectedRoute>{routeSuspense(<CustomerWelcome />, 'ترحيب العملاء')}</ProtectedRoute>} />
      <Route path="/customer-coding" element={<ProtectedRoute>{routeSuspense(<CustomerCoding />, 'تكويد العملاء')}</ProtectedRoute>} />
      <Route path="/quick-replies" element={<ProtectedRoute>{routeSuspense(<QuickReplies />, 'الردود السريعة')}</ProtectedRoute>} />
      <Route path="/doctor-competition" element={<ProtectedRoute>{routeSuspense(<DoctorCompetition />, 'مسابقة الدكاترة')}</ProtectedRoute>} />
      <Route path="/team" element={<ProtectedRoute>{routeSuspense(<Team />, 'الفريق')}</ProtectedRoute>} />
      <Route path="/schedule" element={<ProtectedRoute>{routeSuspense(<Schedule />, 'الجدول')}</ProtectedRoute>} />
      <Route path="/points" element={<ProtectedRoute>{routeSuspense(<Points />, 'النقاط')}</ProtectedRoute>} />
      <Route path="/delivery" element={<ProtectedRoute>{routeSuspense(<Delivery />, 'الدليفري')}</ProtectedRoute>} />
      <Route path="/analytics" element={<ProtectedRoute>{routeSuspense(<Analytics />, 'التحليلات')}</ProtectedRoute>} />
      <Route path="/invoices" element={<ProtectedRoute>{routeSuspense(<Invoices />, 'الفواتير')}</ProtectedRoute>} />
      <Route path="/activity-log" element={<ProtectedRoute>{routeSuspense(<ActivityLog />, 'سجل الأنشطة')}</ProtectedRoute>} />
      <Route path="/reviews" element={<ProtectedRoute>{routeSuspense(<Reviews />, 'التقييمات')}</ProtectedRoute>} />
      <Route path="/shift-performance" element={<ProtectedRoute>{routeSuspense(<ShiftPerformance />, 'تقييم الشيفت')}</ProtectedRoute>} />
      <Route path="/shift-notes" element={<ProtectedRoute>{routeSuspense(<ShiftNotes />, 'ملاحظات الشيفت')}</ProtectedRoute>} />
      <Route path="/staff/:id" element={<ProtectedRoute>{routeSuspense(<StaffDetail />, 'تفاصيل الموظف')}</ProtectedRoute>} />
      <Route path="/time-off" element={<ProtectedRoute>{routeSuspense(<TimeOff />, 'الأذونات')}</ProtectedRoute>} />
      <Route path="/stagnant-medicines" element={<ProtectedRoute>{routeSuspense(<StagnantMedicines />, 'الرواكد')}</ProtectedRoute>} />
      <Route path="/incentive-medicines" element={<ProtectedRoute>{routeSuspense(<IncentiveMedicines />, 'اللستة')}</ProtectedRoute>} />
      <Route path="/staff-accounts" element={<ProtectedRoute>{routeSuspense(<StaffAccounts />, 'حسابات الموظفين')}</ProtectedRoute>} />
      <Route path="/staff-duplicate-audit" element={<ProtectedRoute>{routeSuspense(<StaffDuplicateAudit />, 'مراجعة التكرار')}</ProtectedRoute>} />
      <Route path="/penalty-incentive" element={<ProtectedRoute>{routeSuspense(<PenaltyIncentiveManagement />, 'الجزاءات والمكافآت')}</ProtectedRoute>} />
      <Route path="/staff-dashboard" element={<ProtectedRoute>{routeSuspense(<StaffDashboard />, 'لوحة الموظف')}</ProtectedRoute>} />
      <Route path="/roles-permissions" element={<ProtectedRoute>{routeSuspense(<RolesPermissions />, 'الأدوار والصلاحيات')}</ProtectedRoute>} />
      <Route path="/shelf-organization" element={<ProtectedRoute>{routeSuspense(<ShelfOrganization />, 'تنظيم الأرفف')}</ProtectedRoute>} />
      <Route path="/branch-cleaning" element={<ProtectedRoute>{routeSuspense(<BranchCleaning />, 'نظافة الفرع')}</ProtectedRoute>} />
      <Route path="/inventory-counts" element={<ProtectedRoute>{routeSuspense(<InventoryCounts />, 'الجرد')}</ProtectedRoute>} />
      <Route path="/shortages" element={<ProtectedRoute>{routeSuspense(<Shortages />, 'النواقص')}</ProtectedRoute>} />
      <Route path="/supplies" element={<ProtectedRoute>{routeSuspense(<Supplies />, 'المستلزمات')}</ProtectedRoute>} />
      <Route path="/purchases" element={<ProtectedRoute>{routeSuspense(<Purchases />, 'المشتريات')}</ProtectedRoute>} />
      <Route path="/staff-payroll" element={<ProtectedRoute>{routeSuspense(<StaffPayroll />, 'الرواتب')}</ProtectedRoute>} />
      <Route path="/accessories" element={<ProtectedRoute>{routeSuspense(<Accessories />, 'الإكسسوارات')}</ProtectedRoute>} />
      <Route path="/offers" element={<ProtectedRoute>{routeSuspense(<Offers />, 'العروض')}</ProtectedRoute>} />
      <Route path="/stories" element={<ProtectedRoute>{routeSuspense(<Stories />, 'القصص')}</ProtectedRoute>} />
      <Route path="/training" element={<ProtectedRoute>{routeSuspense(<Training />, 'التدريب')}</ProtectedRoute>} />
      <Route path="/whatsapp-analytics" element={<ProtectedRoute>{routeSuspense(<WhatsappAnalytics />, 'تحليلات واتساب')}</ProtectedRoute>} />
      <Route path="/medicine-expiry" element={<ProtectedRoute>{routeSuspense(<MedicineExpiryTracker />, 'الصلاحية')}</ProtectedRoute>} />
      <Route path="/attendance-report" element={<ProtectedRoute>{routeSuspense(<AttendanceReport />, 'الحضور')}</ProtectedRoute>} />
      <Route path="/loyalty-tiers" element={<ProtectedRoute>{routeSuspense(<LoyaltyTiers />, 'درجات الولاء')}</ProtectedRoute>} />
      <Route path="/daily-command" element={<ProtectedRoute>{routeSuspense(<DailyCommand />, 'الأمر اليومي')}</ProtectedRoute>} />
      <Route path="/daily-target" element={<ProtectedRoute>{routeSuspense(<DailyTarget />, 'الهدف اليومي')}</ProtectedRoute>} />
      <Route path="/today-brief" element={<ProtectedRoute>{routeSuspense(<TodayBrief />, 'ملخص اليوم')}</ProtectedRoute>} />
      <Route path="/refill-reminders" element={<ProtectedRoute>{routeSuspense(<RefillReminders />, 'تذكير إعادة الشراء')}</ProtectedRoute>} />
      <Route path="/customer-health/:id" element={<ProtectedRoute>{routeSuspense(<CustomerHealthProfile />, 'الملف الصحي')}</ProtectedRoute>} />
      <Route path="/expiry-discounts" element={<ProtectedRoute>{routeSuspense(<ExpiryDiscounts />, 'خصومات الصلاحية')}</ProtectedRoute>} />
      <Route path="/employee-kpi" element={<ProtectedRoute>{routeSuspense(<EmployeeKpi />, 'مؤشرات الموظف')}</ProtectedRoute>} />
      <Route path="/employee-operating-system" element={<ProtectedRoute>{routeSuspense(<EmployeeOperatingSystem />, 'نظام تشغيل الموظف')}</ProtectedRoute>} />
      <Route path="/supplier-performance" element={<ProtectedRoute>{routeSuspense(<SupplierPerformance />, 'أداء الموردين')}</ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute>{routeSuspense(<ReportsCenter />, 'مركز التقارير')}</ProtectedRoute>} />
      <Route path="/stock-alerts" element={<ProtectedRoute>{routeSuspense(<StockAlerts />, 'تنبيهات المخزون')}</ProtectedRoute>} />
      <Route path="/returns" element={<ProtectedRoute>{routeSuspense(<Returns />, 'المرتجعات')}</ProtectedRoute>} />
      <Route path="/diagnostics" element={<ProtectedRoute>{routeSuspense(<Diagnostics />, 'التشخيص')}</ProtectedRoute>} />
      <Route path="*" element={routeSuspense(<NotFound />, 'الصفحة')} />
    </Routes>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <PWABanner />
          <AppHealthBanner />
          <AppRoutes />
          <Toaster richColors position="top-center" />
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
