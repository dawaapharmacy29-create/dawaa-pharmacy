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
const DoctorDashboard = lazy(() => import('@/pages/DoctorDashboard'));
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
              واجه التطبيق خطأ أثناء التحميل. تم تجهيز إصلاح خاص لمسح الكاش القديم وإعادة فتح صفحة الدخول.
            </p>
            {this.state.isIOS && (
              <p className="mt-2 rounded-xl border border-teal-500/20 bg-teal-500/10 px-3 py-2 text-xs text-teal-100">
                تم اكتشاف iPhone/Safari. اضغط زر الإصلاح بالأسفل مرة واحدة.
              </p>
            )}
            <div className="mt-6 flex flex-col gap-3">
              <a
                href={loginRecoveryUrl('app_error')}
                className="w-full rounded-2xl bg-teal-600 py-3 text-sm font-black text-white hover:bg-teal-500 transition"
              >
                فتح تسجيل الدخول
              </a>
              <a
                href={diagnosticsUrl('app_error')}
                className="w-full rounded-2xl border border-slate-700 py-3 text-sm font-black text-slate-300 hover:bg-slate-800 transition"
              >
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

function safePage(component: ReactNode, pageName: string) {
  return <PageSafetyBoundary pageName={pageName}>{routeSuspense(component, pageName)}</PageSafetyBoundary>;
}

function protectedElement(component: ReactNode, admin = false, pageName = 'صفحة داخلية') {
  const content = admin ? <AdminRoute>{routeSuspense(component, pageName)}</AdminRoute> : routeSuspense(component, pageName);
  return (
    <PageSafetyBoundary pageName={pageName}>
      <ProtectedRoute>{content}</ProtectedRoute>
    </PageSafetyBoundary>
  );
}

function publicElement(component: ReactNode, pageName = 'صفحة عامة') {
  return safePage(component, pageName);
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppErrorBoundary>
          <AppHealthBanner />
          <Toaster
            position="top-left"
            toastOptions={{
              style: {
                background: 'var(--dawaa-theme-surface)',
                border: '1px solid var(--dawaa-theme-border)',
                color: 'var(--dawaa-theme-heading)',
                fontFamily: 'Cairo, sans-serif',
                direction: 'rtl',
              },
            }}
            richColors
          />
          <PWABanner />
          <Routes>
            <Route path="/login" element={publicElement(<Login />, 'تسجيل الدخول')} />
            <Route path="/diagnostics" element={publicElement(<Diagnostics />, 'التشخيص')} />
            <Route path="/" element={protectedElement(<ExecutiveDashboardRoute />, false, 'لوحة القيادة 2027')} />
            <Route
              path="/dashboard-classic"
              element={protectedElement(<Navigate to="/executive-2027" replace />, false, 'لوحة القيادة 2027')}
            />
            <Route
              path="/executive-2027"
              element={protectedElement(<ExecutiveDashboardRoute />, false, 'لوحة القيادة 2027')}
            />
            <Route path="/executive-dashboard" element={<Navigate to="/executive-2027" replace />} />
            <Route
              path="/evaluation-rules"
              element={protectedElement(<EvaluationRules2027 />, true, 'قواعد التقييم')}
            />
            <Route
              path="/quarterly-incentives"
              element={protectedElement(<QuarterlyIncentives2027 />, false, 'حوافز الربع')}
            />
            <Route
              path="/operations-center"
              element={protectedElement(<OperationsCenter2027 />, false, 'مركز التشغيل')}
            />
            <Route path="/data-health" element={protectedElement(<DataHealthCenter />, false, 'صحة البيانات')} />
            <Route path="/daily-command" element={protectedElement(<DailyCommand />, false, 'أوامر اليوم')} />
            <Route path="/daily-target" element={protectedElement(<DailyTarget />, false, 'هدف اليوم')} />
            <Route path="/today-brief" element={protectedElement(<TodayBrief />, false, 'ملخص اليوم')} />
            <Route path="/customers" element={protectedElement(<Customers />, false, 'العملاء')} />
            <Route path="/customer-360" element={protectedElement(<Customer360 />, false, 'ملف العميل')} />
            <Route
              path="/customers/import"
              element={protectedElement(<CustomerImport />, true, 'استيراد العملاء')}
            />
            <Route path="/customer-service" element={protectedElement(<CustomerService />, false, 'متابعة العملاء')} />
            <Route path="/customer-service-classic" element={protectedElement(<CustomerServiceClassic />, false, 'متابعة العملاء القديمة')} />
            <Route path="/customer-requests" element={protectedElement(<CustomerRequests />, false, 'طلبات العملاء')} />
            <Route
              path="/customer-data-review"
              element={protectedElement(<CustomerDataReview />, false, 'مراجعة بيانات العملاء')}
            />
            <Route path="/crm" element={protectedElement(<CRMPage />, false, 'CRM')} />
            <Route path="/incubation" element={protectedElement(<CustomerIncubation />, false, 'رعاية العملاء')} />
            <Route path="/customer-welcome" element={protectedElement(<CustomerWelcome />, false, 'ترحيب العملاء')} />
            <Route path="/customer-coding" element={protectedElement(<CustomerCoding />, false, 'تكويد العملاء')} />
            <Route path="/quick-replies" element={protectedElement(<QuickReplies />, false, 'الردود السريعة')} />
            <Route path="/doctor-competition" element={protectedElement(<DoctorCompetition />, false, 'مسابقة الدكاترة')} />
            <Route path="/customer-cashback" element={protectedElement(<CustomerCashback />, false, 'كاش باك العملاء')} />
            <Route path="/loyalty-tiers" element={protectedElement(<LoyaltyTiers />, false, 'شرائح الولاء')} />
            <Route path="/refill-reminders" element={protectedElement(<RefillReminders />, false, 'تذكير الروشتات')} />
            <Route
              path="/customer-health"
              element={protectedElement(<CustomerHealthProfile />, false, 'الملف الصحي')}
            />
            <Route
              path="/customer-service-credit"
              element={protectedElement(<CustomerServiceCredit />, false, 'رصيد خدمة العملاء')}
            />
            <Route
              path="/customer-points-ledger"
              element={protectedElement(<CustomerPointsLedger />, false, 'دفتر نقاط العملاء')}
            />
            <Route path="/welcome-messages" element={protectedElement(<WelcomeMessages />, false, 'رسائل الترحيب')} />
            <Route path="/shift-notes" element={protectedElement(<ShiftNotes />, false, 'ملاحظات الشيفت')} />
            <Route path="/shelf-organization" element={protectedElement(<ShelfOrganization />, false, 'تنظيم الرفوف')} />
            <Route path="/branch-cleaning" element={protectedElement(<BranchCleaning />, false, 'نظافة الفرع')} />
            <Route path="/inventory-counts" element={protectedElement(<InventoryCounts />, false, 'الجرد')} />
            <Route path="/shortages" element={protectedElement(<Shortages />, false, 'النواقص')} />
            <Route path="/supplies" element={protectedElement(<Supplies />, false, 'التوريدات')} />
            <Route path="/accessories" element={protectedElement(<Accessories />, false, 'الإكسسوارات')} />
            <Route path="/offers" element={protectedElement(<Offers />, false, 'العروض')} />
            <Route path="/stories" element={protectedElement(<Stories />, false, 'الاستوريز')} />
            <Route path="/stories-offers" element={<Navigate to="/offers" replace />} />
            <Route path="/training" element={protectedElement(<Training />, false, 'التدريب')} />
            <Route path="/whatsapp-analytics" element={protectedElement(<WhatsappAnalytics />, false, 'تحليل الواتساب')} />
            <Route path="/team" element={protectedElement(<Team />, false, 'الفريق')} />
            <Route path="/staff" element={protectedElement(<Team />, false, 'الفريق')} />
            <Route path="/employees" element={<Navigate to="/team" replace />} />
            <Route path="/staff/:id" element={protectedElement(<StaffDetail />, false, 'تفاصيل الموظف')} />
            <Route path="/schedule" element={protectedElement(<Schedule />, false, 'الجدول')} />
            <Route path="/points" element={protectedElement(<Points />, false, 'النقاط')} />
            <Route path="/reviews" element={protectedElement(<Reviews />, false, 'التقييمات')} />
            <Route path="/shift-performance" element={protectedElement(<ShiftPerformance />, false, 'أداء الشيفت')} />
            <Route path="/time-off" element={protectedElement(<TimeOff />, false, 'الأذونات والإجازات')} />
            <Route path="/doctor-dashboard" element={protectedElement(<DoctorDashboard />, false, 'لوحة الدكتور')} />
            <Route path="/stagnant-medicines" element={protectedElement(<StagnantMedicines />, false, 'الرواكد')} />
            <Route
              path="/medicine-expiry"
              element={protectedElement(<MedicineExpiryTracker />, false, 'انتهاء الصلاحية')}
            />
            <Route path="/expiry-discounts" element={protectedElement(<ExpiryDiscounts />, false, 'خصومات الصلاحية')} />
            <Route path="/attendance-report" element={protectedElement(<AttendanceReport />, false, 'تقرير الحضور')} />
            <Route path="/attendance" element={<Navigate to="/attendance-report" replace />} />
            <Route
              path="/incentive-medicines"
              element={protectedElement(<IncentiveMedicines />, false, 'حوافز الرواكد')}
            />
            <Route path="/staff-accounts" element={protectedElement(<StaffAccounts />, true, 'حسابات الموظفين')} />
            <Route
              path="/staff-duplicate-audit"
              element={protectedElement(<StaffDuplicateAudit />, true, 'مراجعة تكرار الموظفين')}
            />
            <Route
              path="/roles-permissions"
              element={protectedElement(<RolesPermissions />, true, 'الصلاحيات')}
            />
            <Route path="/delivery" element={protectedElement(<Delivery />, false, 'الدليفري')} />
            <Route path="/branch-comparison" element={protectedElement(<BranchComparison />, false, 'مقارنة الفروع')} />
            <Route path="/branch-inspection" element={protectedElement(<BranchInspection />, false, 'مرور مدير الفروع')} />
            <Route path="/analytics" element={protectedElement(<Analytics />, false, 'التحليلات')} />
            <Route path="/analytics-sales" element={protectedElement(<Analytics />, false, 'تحليل المبيعات')} />
            <Route path="/purchases" element={protectedElement(<Purchases />, false, 'المشتريات')} />
            <Route path="/staff-payroll" element={protectedElement(<StaffPayroll />, false, 'الرواتب')} />
            <Route path="/payroll" element={<Navigate to="/staff-payroll" replace />} />
            <Route path="/invoices" element={protectedElement(<Invoices />, false, 'الفواتير')} />
            <Route path="/activity-log" element={protectedElement(<ActivityLog />, true, 'سجل الأنشطة')} />
            <Route path="/activity-logs" element={<Navigate to="/activity-log" replace />} />
            <Route
              path="/penalty-incentive"
              element={protectedElement(<PenaltyIncentiveManagement />, true, 'الخصومات والحوافز')}
            />
            <Route path="/staff-dashboard" element={protectedElement(<StaffDashboard />, false, 'لوحة الموظف')} />
            <Route path="/employee-kpi" element={protectedElement(<EmployeeKpi />, false, 'مؤشرات الموظفين')} />
            <Route
              path="/employee-operating-system"
              element={protectedElement(<EmployeeOperatingSystem />, false, 'مهام الفريق')}
            />
            <Route
              path="/supplier-performance"
              element={protectedElement(<SupplierPerformance />, false, 'أداء الموردين')}
            />
            <Route path="/reports" element={protectedElement(<ReportsCenter />, false, 'مركز التقارير')} />
            <Route path="/stock-alerts" element={protectedElement(<StockAlerts />, false, 'تنبيهات المخزون')} />
            <Route path="/returns" element={protectedElement(<Returns />, false, 'المرتجعات')} />
            <Route path="*" element={publicElement(<NotFound />, 'صفحة غير موجودة')} />
          </Routes>
        </AppErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
