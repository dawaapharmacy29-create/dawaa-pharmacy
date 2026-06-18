import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, lazy, Suspense, type ReactNode } from "react";
import { Toaster } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/layout/Layout";
import { LOGO_URL } from "@/lib/constants";
import PWABanner from "@/components/features/PWABanner";

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

const Login = lazy(() => import("@/pages/Login"));
const ExecutiveDashboard2027 = lazy(() => import("@/pages/ExecutiveDashboard2027"));
const BranchComparison = lazy(() => import("@/pages/BranchComparison"));
const BranchInspection = lazy(() => import("@/pages/BranchInspection"));
const EvaluationRules2027 = lazy(() => import("@/pages/EvaluationRules2027"));
const QuarterlyIncentives2027 = lazy(() => import("@/pages/QuarterlyIncentives2027"));
const OperationsCenter2027 = lazy(() => import("@/pages/OperationsCenter2027"));
const DataHealthCenter = lazy(() => import("@/pages/DataHealthCenter"));
const Customers = lazy(() => import("@/pages/Customers"));
const Customer360 = lazy(() => import("@/pages/Customer360"));
const CustomerImport = lazy(() => import("@/pages/CustomerImport"));
const CustomerService = lazy(() => import("@/pages/CustomerService"));
const CustomerRequests = lazy(() => import("@/pages/CustomerRequests"));
const CustomerIncubation = lazy(() => import("@/pages/CustomerIncubation"));
const CustomerDataReview = lazy(() => import("@/pages/CustomerDataReview"));
const CRMPage = lazy(() => import("@/pages/CRMPage"));
const CustomerCashback = lazy(() => import("@/pages/CustomerCashback"));
const CustomerServiceCredit = lazy(() => import("@/pages/CustomerServiceCredit"));
const CustomerWelcome = lazy(() => import("@/pages/CustomerWelcome"));
const CustomerCoding = lazy(() => import("@/pages/CustomerCoding"));
const Team = lazy(() => import("@/pages/Team"));
const Schedule = lazy(() => import("@/pages/Schedule"));
const Points = lazy(() => import("@/pages/Points"));
const Delivery = lazy(() => import("@/pages/Delivery"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Invoices = lazy(() => import("@/pages/Invoices"));
const ActivityLog = lazy(() => import("@/pages/ActivityLog"));
const Reviews = lazy(() => import("@/pages/Reviews"));
const ShiftPerformance = lazy(() => import("@/pages/ShiftPerformance"));
const ShiftNotes = lazy(() => import("@/pages/ShiftNotes"));
const StaffDetail = lazy(() => import("@/pages/StaffDetail"));
const TimeOff = lazy(() => import("@/pages/TimeOff"));
const DoctorDashboard = lazy(() => import("@/pages/DoctorDashboard"));
const StagnantMedicines = lazy(() => import("@/pages/StagnantMedicines"));
const IncentiveMedicines = lazy(() => import("@/pages/IncentiveMedicines"));
const StaffAccounts = lazy(() => import("@/pages/StaffAccounts"));
const StaffDuplicateAudit = lazy(() => import("@/pages/StaffDuplicateAudit"));
const PenaltyIncentiveManagement = lazy(() => import("@/pages/PenaltyIncentiveManagement"));
const StaffDashboard = lazy(() => import("@/pages/StaffDashboard"));
const RolesPermissions = lazy(() => import("@/pages/RolesPermissions"));
const ShelfOrganization = lazy(() => import("@/pages/ShelfOrganization"));
const BranchCleaning = lazy(() => import("@/pages/BranchCleaning"));
const InventoryCounts = lazy(() => import("@/pages/InventoryCounts"));
const Shortages = lazy(() => import("@/pages/Shortages"));
const Supplies = lazy(() => import("@/pages/Supplies"));
const Purchases = lazy(() => import("@/pages/Purchases"));
const StaffPayroll = lazy(() => import("@/pages/StaffPayroll"));
const Accessories = lazy(() => import("@/pages/Accessories"));
const Offers = lazy(() => import("@/pages/Offers"));
const Stories = lazy(() => import("@/pages/Stories"));
const Training = lazy(() => import("@/pages/Training"));
const WhatsappAnalytics = lazy(() => import("@/pages/WhatsappAnalytics"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const MedicineExpiryTracker = lazy(() => import("@/pages/MedicineExpiryTracker"));
const AttendanceReport = lazy(() => import("@/pages/AttendanceReport"));
const LoyaltyTiers = lazy(() => import("@/pages/LoyaltyTiers"));
const DailyCommand = lazy(() => import("@/pages/DailyCommand"));
const DailyTarget = lazy(() => import("@/pages/DailyTarget"));
const TodayBrief = lazy(() => import("@/pages/TodayBrief"));
const RefillReminders = lazy(() => import("@/pages/RefillReminders"));
const CustomerHealthProfile = lazy(() => import("@/pages/CustomerHealthProfile"));
const ExpiryDiscounts = lazy(() => import("@/pages/ExpiryDiscounts"));
const EmployeeKpi = lazy(() => import("@/pages/EmployeeKpi"));
const SupplierPerformance = lazy(() => import("@/pages/SupplierPerformance"));

const ROUTE_PERMISSIONS: Record<string, string> = {
  "/": "page.dashboard.view",
  "/executive-2027": "page.dashboard.view",
  "/data-health": "page.dashboard.view",
  "/operations-center": "page.dashboard.view",
  "/customers": "page.customers.view",
  "/customer-360": "page.customers.view",
  "/customers/import": "customers.action.import",
  "/customer-service": "page.customer_service.view",
  "/customer-data-review": "page.customer_data_review.view",
  "/crm": "page.crm.view",
  "/incubation": "page.incubation.view",
  "/customer-requests": "customer_service.section.daily_followups",
  "/customer-welcome": "customer_service.section.whatsapp_templates",
  "/customer-coding": "page.customer_service.view",
  "/customer-cashback": "page.customer_cashback.view",
  "/customer-service-credit": "page.customer_cashback.view",
  "/reviews": "page.reviews.view",
  "/whatsapp-analytics": "page.reviews.view",
  "/team": "page.team.view",
  "/schedule": "page.schedule.view",
  "/time-off": "page.schedule.view",
  "/shift-notes": "page.shift_notes.view",
  "/shift-performance": "page.reviews.view",
  "/staff-accounts": "page.staff_accounts.view",
  "/roles-permissions": "staff_accounts.action.permissions",
  "/analytics": "page.analytics.view",
  "/purchases": "page.analytics.view",
  "/staff-payroll": "page.points.view",
  "/invoices": "page.invoices.view",
  "/points": "page.points.view",
  "/delivery": "page.delivery.view",
  "/activity-log": "page.activity_log.view",
  "/stagnant-medicines": "page.stagnant_medicines.view",
  "/incentive-medicines": "page.incentive_medicines.view",
  "/branch-cleaning": "page.branch_cleaning.view",
  "/medicine-expiry": "page.stagnant_medicines.view",
  "/attendance-report": "page.team.view",
  "/loyalty-tiers": "page.customer_cashback.view",
  "/daily-command": "page.dashboard.view",
  "/daily-target": "page.dashboard.view",
  "/today-brief": "page.dashboard.view",
  "/refill-reminders": "page.customers.view",
  "/customer-health": "page.customers.view",
  "/expiry-discounts": "page.stagnant_medicines.view",
  "/employee-kpi": "page.team.view",
  "/supplier-performance": "page.analytics.view",
};

function AppLoading() {
  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center" dir="rtl">
      <div className="flex flex-col items-center gap-4">
        <img src={LOGO_URL} alt="Dawaa" loading="lazy" className="w-16 h-16 rounded-2xl object-contain animate-pulse-soft" />
        <div className="w-8 h-8 border-3 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
        <div className="text-slate-400 text-sm">جاري التحميل...</div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, loading, checkPermission } = useAuth();
  const location = useLocation();
  const effectivePermission = permission || ROUTE_PERMISSIONS[location.pathname];

  if (loading) return <AppLoading />;
  if (!user) return <Navigate to="/login" replace />;

  if (effectivePermission && !checkPermission(effectivePermission)) {
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
    return <div className="stat-card text-center text-slate-300 py-16" dir="rtl">ليس لديك صلاحية للوصول إلى هذه الصفحة.</div>;
  }
  return <>{children}</>;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("App error boundary caught error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6" dir="rtl">
          <div className="rounded-3xl border border-red-500/20 bg-slate-900 p-8 text-center text-slate-200 shadow-2xl max-w-md w-full">
            <div className="mb-4 text-5xl">⚠️</div>
            <h1 className="text-2xl font-black text-white">حدث خطأ غير متوقع</h1>
            <p className="mt-3 text-sm text-slate-400 leading-relaxed">واجه التطبيق خطأ أثناء التحميل. جرّب إعادة التحميل أو تواصل مع الدعم الفني.</p>
            <div className="mt-6 flex flex-col gap-3">
              <button onClick={() => window.location.reload()} className="w-full rounded-2xl bg-teal-600 py-3 text-sm font-black text-white hover:bg-teal-500 transition">🔄 إعادة تحميل التطبيق</button>
              <button onClick={() => { this.setState({ hasError: false }); window.history.back(); }} className="w-full rounded-2xl border border-slate-700 py-3 text-sm font-black text-slate-300 hover:bg-slate-800 transition">← العودة للصفحة السابقة</button>
            </div>
          </div>
        </div>
      );
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
                background: "var(--dawaa-theme-surface)",
                border: "1px solid var(--dawaa-theme-border)",
                color: "var(--dawaa-theme-heading)",
                fontFamily: "Cairo, sans-serif",
                direction: "rtl",
              },
            }}
            richColors
          />
          <PWABanner />
          <Suspense fallback={<AppLoading />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={protectedElement(<ExecutiveDashboard2027 />)} />
              <Route path="/dashboard-classic" element={protectedElement(<Navigate to="/executive-2027" replace />)} />
              <Route path="/executive-2027" element={protectedElement(<ExecutiveDashboard2027 />)} />
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
              <Route path="/customer-requests" element={protectedElement(<CustomerRequests />)} />
              <Route path="/customer-data-review" element={protectedElement(<CustomerDataReview />)} />
              <Route path="/crm" element={protectedElement(<CRMPage />)} />
              <Route path="/incubation" element={protectedElement(<CustomerIncubation />)} />
              <Route path="/customer-welcome" element={protectedElement(<CustomerWelcome />)} />
              <Route path="/customer-coding" element={protectedElement(<CustomerCoding />)} />
              <Route path="/customer-cashback" element={protectedElement(<CustomerCashback />)} />
              <Route path="/loyalty-tiers" element={protectedElement(<LoyaltyTiers />)} />
              <Route path="/refill-reminders" element={protectedElement(<RefillReminders />)} />
              <Route path="/customer-health" element={protectedElement(<CustomerHealthProfile />)} />
              <Route path="/customer-service-credit" element={protectedElement(<CustomerServiceCredit />)} />
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
              <Route path="/invoices" element={protectedElement(<Invoices />)} />
              <Route path="/activity-log" element={protectedElement(<ActivityLog />, true)} />
              <Route path="/penalty-incentive" element={protectedElement(<PenaltyIncentiveManagement />, true)} />
              <Route path="/staff-dashboard" element={protectedElement(<StaffDashboard />)} />
              <Route path="/employee-kpi" element={protectedElement(<EmployeeKpi />)} />
              <Route path="/supplier-performance" element={protectedElement(<SupplierPerformance />)} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
