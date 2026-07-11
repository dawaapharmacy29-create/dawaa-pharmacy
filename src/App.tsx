import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { isIOSWebKit } from '@/lib/mobileSafariCompat';
import { Toaster } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getRoutePermissions } from '@/lib/core/permissionSystem';
import Layout from '@/components/layout/Layout';
import { LOGO_URL } from '@/lib/constants';
import PWABanner from '@/components/features/PWABanner';
import { isDoctorRole } from '@/lib/security/userDataScope';
import AppRecoveryScreen from '@/components/system/AppRecoveryScreen';
import { diagnosticsUrl, logRuntimeError, loginRecoveryUrl } from '@/lib/appRecovery';
import PageSafetyBoundary from '@/components/system/PageSafetyBoundary';
import AppHealthBanner from '@/components/system/AppHealthBanner';

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
const ExecutiveDashboardProduction = lazy(() => import('@/pages/ExecutiveDashboardProduction'));
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

function AppLoading() {
  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center" dir="rtl">
      <div className="flex flex-col items-center gap-4">
        <img
          src={LOGO_URL}
          alt="Dawaa"
          loading="lazy"
          className="w-16 h-16 rounded-2xl object-contain animate-pulse-soft"
        />
        <div className="w-8 h-8 border-3 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
        <div className="text-slate-400 text-sm">جاري التحميل...</div>
      </div>
    </div>
  );
}

function SlowLoadingRecovery() {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => setIsSlow(true), 8000);
    return () => window.clearTimeout(timerId);
  }, []);

  if (isSlow) {
    return (
      <AppRecoveryScreen
        reason="slow_loading"
        title="استغرق التحميل وقتًا طويلًا"
        message="لم يكتمل تحميل الصفحة خلال 8 ثوانٍ. يمكنك فتح تسجيل الدخول فورًا أو تشغيل التشخيص لمعرفة السبب."
      />
    );
  }

  return <AppLoading />;
}

function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, loading, checkPermission } = useAuth();
  const location = useLocation();
  const effectivePermissions = permission || getRoutePermissions(location.pathname);

  if (loading) return <SlowLoadingRecovery />;
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
              واجه التطبيق خطأ أثناء التحميل. تم تجهيز إصلاح خاص لمتصفح iPhone/Safari لمسح الكاش القديم وإعادة فتح صفحة الدخول.
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
  return <PageSafetyBoundary pageName={pageName}>{component}</PageSafetyBoundary>;
}

function protectedElement(component: ReactNode, admin = false, pageName = 'صفحة داخلية') {
  const content = admin ? <AdminRoute>{component}</AdminRoute> : component;
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
          <Suspense fallback={<SlowLoadingRecovery />}>
            <Routes>
              <Route path="/login" element={publicElement(<Login />, 'تسجيل الدخول')} />
              <Route path="/diagnostics" element={publicElement(<Diagnostics />, 'التشخيص')} />
              <Route path="/" element={protectedElement(<ExecutiveDashboardProduction />, false, 'لوحة القيادة 2027')} />
              <Route
                path="/dashboard-classic"
                element={protectedElement(<Navigate to="/executive-2027" replace />)}
              />
              <Route
                path="/executive-2027"
                element={protectedElement(<ExecutiveDashboardProduction />, false, 'لوحة القيادة 2027')}
              />
              <Route path="/executive-dashboard" element={<Navigate to="/executive-2027" replace />} />
              <Route
                path="/evaluation-rules"
                element={protectedElement(<EvaluationRules2027 />, true)}
              />
              <Route
                path="/quarterly-incentives"
                element={protectedElement(<QuarterlyIncentives2027 />)}
              />
              <Route
                path="/operations-center"
                element={protectedElement(<OperationsCenter2027 />)}
              />
              <Route path="/data-health" element={protectedElement(<DataHealthCenter />)} />
              <Route path="/daily-command" element={protectedElement(<DailyCommand />)} />
              <Route path="/daily-target" element={protectedElement(<DailyTarget />)} />
              <Route path="/today-brief" element={protectedElement(<TodayBrief />)} />
              <Route path="/customers" element={protectedElement(<Customers />)} />
              <Route path="/customer-360" element={protectedElement(<Customer360 />)} />
              <Route
                path="/customers/import"
                element={protectedElement(<CustomerImport />, true)}
              />
              <Route path="/customer-service" element={protectedElement(<CustomerService />, false, 'متابعة العملاء')} />
              <Route path="/customer-service-classic" element={protectedElement(<CustomerServiceClassic />)} />
              <Route path="/customer-requests" element={protectedElement(<CustomerRequests />)} />
              <Route
                path="/customer-data-review"
                element={protectedElement(<CustomerDataReview />, false, 'مراجعة بيانات العملاء')}
              />
              <Route path="/crm" element={protectedElement(<CRMPage />)} />
              <Route path="/incubation" element={protectedElement(<CustomerIncubation />)} />
              <Route path="/customer-welcome" element={protectedElement(<CustomerWelcome />)} />
              <Route path="/customer-coding" element={protectedElement(<CustomerCoding />)} />
              <Route path="/quick-replies" element={protectedElement(<QuickReplies />)} />
              <Route path="/doctor-competition" element={protectedElement(<DoctorCompetition />)} />
              <Route path="/customer-cashback" element={protectedElement(<CustomerCashback />)} />
              <Route path="/loyalty-tiers" element={protectedElement(<LoyaltyTiers />)} />
              <Route path="/refill-reminders" element={protectedElement(<RefillReminders />)} />
              <Route
                path="/customer-health"
                element={protectedElement(<CustomerHealthProfile />)}
              />
              <Route
                path="/customer-service-credit"
                element={protectedElement(<CustomerServiceCredit />)}
              />
              <Route
                path="/customer-points-ledger"
                element={protectedElement(<CustomerPointsLedger />)}
              />
              <Route path="/welcome-messages" element={protectedElement(<WelcomeMessages />)} />
              <Route path="/shift-notes" element={protectedElement(<ShiftNotes />)} />
              <Route path="/shelf-organization" element={protectedElement(<ShelfOrganization />)} />
              <Route path="/branch-cleaning" element={protectedElement(<BranchCleaning />)} />
              <Route path="/inventory-counts" element={protectedElement(<InventoryCounts />)} />
              <Route path="/shortages" element={protectedElement(<Shortages />)} />
              <Route path="/supplies" element={protectedElement(<Supplies />)} />
              <Route path="/accessories" element={protectedElement(<Accessories />)} />
              <Route path="/offers" element={protectedElement(<Offers />)} />
              <Route path="/stories" element={protectedElement(<Stories />)} />
              <Route path="/stories-offers" element={<Navigate to="/offers" replace />} />
              <Route path="/training" element={protectedElement(<Training />)} />
              <Route path="/whatsapp-analytics" element={protectedElement(<WhatsappAnalytics />)} />
              <Route path="/team" element={protectedElement(<Team />, false, 'الفريق')} />
              <Route path="/staff" element={protectedElement(<Team />)} />
              <Route path="/employees" element={<Navigate to="/team" replace />} />
              <Route path="/staff/:id" element={protectedElement(<StaffDetail />)} />
              <Route path="/schedule" element={protectedElement(<Schedule />)} />
              <Route path="/points" element={protectedElement(<Points />)} />
              <Route path="/reviews" element={protectedElement(<Reviews />)} />
              <Route path="/shift-performance" element={protectedElement(<ShiftPerformance />)} />
              <Route path="/time-off" element={protectedElement(<TimeOff />)} />
              <Route path="/doctor-dashboard" element={protectedElement(<DoctorDashboard />)} />
              <Route path="/stagnant-medicines" element={protectedElement(<StagnantMedicines />)} />
              <Route
                path="/medicine-expiry"
                element={protectedElement(<MedicineExpiryTracker />)}
              />
              <Route path="/expiry-discounts" element={protectedElement(<ExpiryDiscounts />)} />
              <Route path="/attendance-report" element={protectedElement(<AttendanceReport />, false, 'تقرير الحضور')} />
              <Route path="/attendance" element={<Navigate to="/attendance-report" replace />} />
              <Route
                path="/incentive-medicines"
                element={protectedElement(<IncentiveMedicines />)}
              />
              <Route path="/staff-accounts" element={protectedElement(<StaffAccounts />, true, 'حسابات الموظفين')} />
              <Route
                path="/staff-duplicate-audit"
                element={protectedElement(<StaffDuplicateAudit />, true)}
              />
              <Route
                path="/roles-permissions"
                element={protectedElement(<RolesPermissions />, true)}
              />
              <Route path="/delivery" element={protectedElement(<Delivery />)} />
              <Route path="/branch-comparison" element={protectedElement(<BranchComparison />)} />
              <Route path="/branch-inspection" element={protectedElement(<BranchInspection />)} />
              <Route path="/analytics" element={protectedElement(<Analytics />, false, 'التحليلات')} />
              <Route path="/analytics-sales" element={protectedElement(<Analytics />)} />
              <Route path="/purchases" element={protectedElement(<Purchases />)} />
              <Route path="/staff-payroll" element={protectedElement(<StaffPayroll />)} />
              <Route path="/payroll" element={<Navigate to="/staff-payroll" replace />} />
              <Route path="/invoices" element={protectedElement(<Invoices />, false, 'الفواتير')} />
              <Route path="/activity-log" element={protectedElement(<ActivityLog />, true, 'سجل الأنشطة')} />
              <Route path="/activity-logs" element={<Navigate to="/activity-log" replace />} />
              <Route
                path="/penalty-incentive"
                element={protectedElement(<PenaltyIncentiveManagement />, true)}
              />
              <Route path="/staff-dashboard" element={protectedElement(<StaffDashboard />)} />
              <Route path="/employee-kpi" element={protectedElement(<EmployeeKpi />)} />
              <Route
                path="/employee-operating-system"
                element={protectedElement(<EmployeeOperatingSystem />, false, 'مهام الفريق')}
              />
              <Route
                path="/supplier-performance"
                element={protectedElement(<SupplierPerformance />)}
              />
              <Route path="/reports" element={protectedElement(<ReportsCenter />, false, 'مركز التقارير')} />
              <Route path="/stock-alerts" element={protectedElement(<StockAlerts />)} />
              <Route path="/returns" element={protectedElement(<Returns />)} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
