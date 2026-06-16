import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Component, lazy, Suspense, type ReactNode } from "react";
import { Toaster } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/layout/Layout";
import { LOGO_URL } from "@/lib/constants";
import PWABanner from "@/components/features/PWABanner";

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
};

function AppLoading() {
  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center" dir="rtl">
      <div className="flex flex-col items-center gap-4">
        <img
          src={LOGO_URL}
          alt="Dawaa"
          className="w-16 h-16 rounded-2xl object-contain animate-pulse-soft"
        />
        <div className="w-8 h-8 border-3 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
        <div className="text-slate-400 text-sm">جاري التحميل...</div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { user, loading, checkPermission } = useAuth();
  const location = useLocation();
  const effectivePermission = permission || ROUTE_PERMISSIONS[location.pathname];

  if (loading) {
    return <AppLoading />;
  }

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

function AdminRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
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
            <p className="mt-3 text-sm text-slate-400 leading-relaxed">
              واجه التطبيق خطأ أثناء التحميل. جرّب إعادة التحميل أو تواصل مع الدعم الفني.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full rounded-2xl bg-teal-600 py-3 text-sm font-black text-white hover:bg-teal-500 transition"
              >
                🔄 إعادة تحميل التطبيق
              </button>
              <button
                onClick={() => { this.setState({ hasError: false }); window.history.back(); }}
                className="w-full rounded-2xl border border-slate-700 py-3 text-sm font-black text-slate-300 hover:bg-slate-800 transition"
              >
                ← العودة للصفحة السابقة
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
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
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ExecutiveDashboard2027 />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard-classic"
          element={
            <ProtectedRoute>
              <Navigate to="/executive-2027" replace />
            </ProtectedRoute>
          }
        />

        <Route
          path="/executive-2027"
          element={
            <ProtectedRoute>
              <ExecutiveDashboard2027 />
            </ProtectedRoute>
          }
        />
        <Route
          path="/evaluation-rules"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <EvaluationRules2027 />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/quarterly-incentives"
          element={
            <ProtectedRoute>
              <QuarterlyIncentives2027 />
            </ProtectedRoute>
          }
        />
        <Route
          path="/operations-center"
          element={
            <ProtectedRoute>
              <OperationsCenter2027 />
            </ProtectedRoute>
          }
        />
        <Route
          path="/data-health"
          element={
            <ProtectedRoute>
              <DataHealthCenter />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <ProtectedRoute>
              <Customers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-360"
          element={
            <ProtectedRoute>
              <Customer360 />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers/import"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <CustomerImport />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-service"
          element={
            <ProtectedRoute>
              <CustomerService />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-requests"
          element={
            <ProtectedRoute>
              <CustomerRequests />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-data-review"
          element={
            <ProtectedRoute>
              <CustomerDataReview />
            </ProtectedRoute>
          }
        />
        <Route
          path="/crm"
          element={
            <ProtectedRoute>
              <CRMPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/incubation"
          element={
            <ProtectedRoute>
              <CustomerIncubation />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-welcome"
          element={
            <ProtectedRoute>
              <CustomerWelcome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-cashback"
          element={
            <ProtectedRoute>
              <CustomerCashback />
            </ProtectedRoute>
          }
        />
        <Route
          path="/loyalty-tiers"
          element={
            <ProtectedRoute>
              <LoyaltyTiers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-service-credit"
          element={
            <ProtectedRoute>
              <CustomerServiceCredit />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shift-notes"
          element={
            <ProtectedRoute>
              <ShiftNotes />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shelf-organization"
          element={
            <ProtectedRoute>
              <ShelfOrganization />
            </ProtectedRoute>
          }
        />
        <Route
          path="/branch-cleaning"
          element={
            <ProtectedRoute>
              <BranchCleaning />
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory-counts"
          element={
            <ProtectedRoute>
              <InventoryCounts />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shortages"
          element={
            <ProtectedRoute>
              <Shortages />
            </ProtectedRoute>
          }
        />
        <Route
          path="/supplies"
          element={
            <ProtectedRoute>
              <Supplies />
            </ProtectedRoute>
          }
        />
        <Route
          path="/accessories"
          element={
            <ProtectedRoute>
              <Accessories />
            </ProtectedRoute>
          }
        />
        <Route
          path="/offers"
          element={
            <ProtectedRoute>
              <Offers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stories"
          element={
            <ProtectedRoute>
              <Stories />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stories-offers"
          element={
            <Navigate to="/offers" replace />
          }
        />
        <Route
          path="/training"
          element={
            <ProtectedRoute>
              <Training />
            </ProtectedRoute>
          }
        />
        <Route
          path="/whatsapp-analytics"
          element={
            <ProtectedRoute>
              <WhatsappAnalytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/team"
          element={
            <ProtectedRoute>
              <Team />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff"
          element={
            <ProtectedRoute>
              <Team />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employees"
          element={<Navigate to="/team" replace />}
        />
        <Route
          path="/staff/:id"
          element={
            <ProtectedRoute>
              <StaffDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/schedule"
          element={
            <ProtectedRoute>
              <Schedule />
            </ProtectedRoute>
          }
        />
        <Route
          path="/points"
          element={
            <ProtectedRoute>
              <Points />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reviews"
          element={
            <ProtectedRoute>
              <Reviews />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shift-performance"
          element={
            <ProtectedRoute>
              <ShiftPerformance />
            </ProtectedRoute>
          }
        />
        <Route
          path="/time-off"
          element={
            <ProtectedRoute>
              <TimeOff />
            </ProtectedRoute>
          }
        />
        <Route
          path="/doctor-dashboard"
          element={
            <ProtectedRoute>
              <DoctorDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stagnant-medicines"
          element={
            <ProtectedRoute>
              <StagnantMedicines />
            </ProtectedRoute>
          }
        />
        <Route
          path="/medicine-expiry"
          element={
            <ProtectedRoute>
              <MedicineExpiryTracker />
            </ProtectedRoute>
          }
        />
        <Route
          path="/attendance-report"
          element={
            <ProtectedRoute>
              <AttendanceReport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/incentive-medicines"
          element={
            <ProtectedRoute>
              <IncentiveMedicines />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff-accounts"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <StaffAccounts />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff-duplicate-audit"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <StaffDuplicateAudit />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/roles-permissions"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <RolesPermissions />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/delivery"
          element={
            <ProtectedRoute>
              <Delivery />
            </ProtectedRoute>
          }
        />
        <Route
          path="/branch-comparison"
          element={
            <ProtectedRoute>
              <BranchComparison />
            </ProtectedRoute>
          }
        />
        <Route
          path="/branch-inspection"
          element={
            <ProtectedRoute>
              <BranchInspection />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute>
              <Analytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics-sales"
          element={
            <ProtectedRoute>
              <Analytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchases"
          element={
            <ProtectedRoute>
              <Purchases />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff-payroll"
          element={
            <ProtectedRoute>
              <StaffPayroll />
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoices"
          element={
            <ProtectedRoute>
              <Invoices />
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity-log"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <ActivityLog />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/penalty-incentive"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <PenaltyIncentiveManagement />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff-dashboard"
          element={
            <ProtectedRoute>
              <StaffDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </AppErrorBoundary>
    </BrowserRouter>
  );
}
