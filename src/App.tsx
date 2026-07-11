import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getRoutePermissions } from '@/lib/core/permissionSystem';
import Layout from '@/components/layout/Layout';
import PWABanner from '@/components/features/PWABanner';
import { isDoctorRole } from '@/lib/security/userDataScope';
import { AppRecoveryScreen, SlowLoadingRecovery } from '@/components/system/AppRecoveryScreen';
import { recordRuntimeError } from '@/lib/appRecovery';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const ExecutiveDashboard2027 = lazy(() => import('@/pages/ExecutiveDashboard2027'));
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

function AppLoading() {
  return <SlowLoadingRecovery />;
}

function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, loading, checkPermission } = useAuth();
  const location = useLocation();
  const effectivePermissions = permission || getRoutePermissions(location.pathname);

  if (loading) return <AppLoading />;
  if (!user) return <Navigate to="/login" replace />;

  if (location.pathname === '/' && isDoctorRole(user) && !checkPermission('view_executive_dashboard')) {
    return <Navigate to="/doctor-dashboard" replace />;
  }

  const denied = effectivePermissions && (Array.isArray(effectivePermissions)
    ? !effectivePermissions.some((item) => checkPermission(item))
    : !checkPermission(effectivePermissions));

  if (denied) {
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

type ErrorBoundaryState = { hasError: boolean; message?: string };

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'unknown error' };
  }

  componentDidCatch(error: Error, info: unknown) {
    recordRuntimeError(error, 'app-boundary');
    console.error('App error boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return <AppRecoveryScreen technicalError={this.state.message} />;
    }
    return this.props.children;
  }
}

function protectedElement(component: ReactNode, admin = false) {
  const content = admin ? <AdminRoute>{component}</AdminRoute> : component;
  return <ProtectedRoute>{content}</ProtectedRoute>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppErrorBoundary>
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
          <Suspense fallback={<AppLoading />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/diagnostics" element={<Diagnostics />} />
              <Route path="/" element={protectedElement(<Dashboard />)} />
              <Route path="/dashboard-classic" element={protectedElement(<Navigate to="/executive-2027" replace />)} />
              <Route path="/executive-2027" element={protectedElement(<ExecutiveDashboard2027 />)} />
              <Route path="/executive-dashboard" element={<Navigate to="/executive-2027" replace />} />
              <Route path="/evaluation-rules" element={protectedElement(<EvaluationRules2027 />, true)} />
              <Route path="/quarterly-incentives" element={protectedElement(<QuarterlyIncentives2027 />)} />
              <Route path="/operations-center" element={protectedElement(<OperationsCenter2027 />)} />
              <Route path="/data-health" element={protectedElement(<DataHealthCenter />)} />
              <Route path="/daily-command" element={protectedElement(<DailyCommand />)} />
              <Route path="/daily-target" element={protectedElement(<DailyTarget />)} />
              <Route path="/today-brief" element={protectedElement(<TodayBrief />)} />
              <Route path="/customers" element={protectedElement(<Customers />)} />
              <Route path="/customer-360" element={protectedElement(<Customer360 />)} />
              <Route path="/customers/import" element={protectedElement(<CustomerImport />, true)} />
              <Route path="/customer-service" element={protectedElement(<CustomerService />)} />
              <Route path="/customer-service-classic" element={protectedElement(<CustomerServiceClassic />)} />
              <Route path="/customer-requests" element={protectedElement(<CustomerRequests />)} />
              <Route path="/customer-data-review" element={protectedElement(<CustomerDataReview />)} />
              <Route path="/crm" element={protectedElement(<CRMPage />)} />
              <Route path="/incubation" element={protectedElement(<CustomerIncubation />)} />
              <Route path="/customer-welcome" element={protectedElement(<CustomerWelcome />)} />
              <Route path="/customer-coding" element={protectedElement(<CustomerCoding />)} />
              <Route path="/quick-replies" element={protectedElement(<QuickReplies />)} />
              <Route path="/doctor-competition" element={protectedElement(<DoctorCompetition />)} />
              <Route path="/customer-cashback" element={protectedElement(<CustomerCashback />)} />
              <Route path="/loyalty-tiers" element={protectedElement(<LoyaltyTiers />)} />
              <Route path="/refill-reminders" element={protectedElement(<RefillReminders />)} />
              <Route path="/customer-health" element={protectedElement(<CustomerHealthProfile />)} />
              <Route path="/customer-service-credit" element={protectedElement(<CustomerServiceCredit />)} />
              <Route path="/customer-points-ledger" element={protectedElement(<CustomerPointsLedger />)} />
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
              <Route path="/team" element={protectedElement(<Team />)} />
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
              <Route path="/medicine-expiry" element={protectedElement(<MedicineExpiryTracker />)} />
              <Route path="/expiry-discounts" element={protectedElement(<ExpiryDiscounts />)} />
              <Route path="/attendance-report" element={protectedElement(<AttendanceReport />)} />
              <Route path="/attendance" element={<Navigate to="/attendance-report" replace />} />
              <Route path="/incentive-medicines" element={protectedElement(<IncentiveMedicines />)} />
              <Route path="/staff-accounts" element={protectedElement(<StaffAccounts />, true)} />
              <Route path="/staff-duplicate-audit" element={protectedElement(<StaffDuplicateAudit />, true)} />
              <Route path="/roles-permissions" element={protectedElement(<RolesPermissions />, true)} />
              <Route path="/delivery" element={protectedElement(<Delivery />)} />
              <Route path="/branch-comparison" element={protectedElement(<BranchComparison />)} />
              <Route path="/branch-inspection" element={protectedElement(<BranchInspection />)} />
              <Route path="/analytics" element={protectedElement(<Analytics />)} />
              <Route path="/analytics-sales" element={protectedElement(<Analytics />)} />
              <Route path="/purchases" element={protectedElement(<Purchases />)} />
              <Route path="/staff-payroll" element={protectedElement(<StaffPayroll />)} />
              <Route path="/payroll" element={<Navigate to="/staff-payroll" replace />} />
              <Route path="/invoices" element={protectedElement(<Invoices />)} />
              <Route path="/activity-log" element={protectedElement(<ActivityLog />, true)} />
              <Route path="/activity-logs" element={<Navigate to="/activity-log" replace />} />
              <Route path="/penalty-incentive" element={protectedElement(<PenaltyIncentiveManagement />, true)} />
              <Route path="/staff-dashboard" element={protectedElement(<StaffDashboard />)} />
              <Route path="/employee-kpi" element={protectedElement(<EmployeeKpi />)} />
              <Route path="/employee-operating-system" element={protectedElement(<EmployeeOperatingSystem />)} />
              <Route path="/supplier-performance" element={protectedElement(<SupplierPerformance />)} />
              <Route path="/reports" element={protectedElement(<ReportsCenter />)} />
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
