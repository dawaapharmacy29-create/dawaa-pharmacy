import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { Component, type ReactNode } from "react";
import { Toaster } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/layout/Layout";
import { LOGO_URL } from "@/lib/constants";
import PWABanner from "@/components/features/PWABanner";

// ── Lazy-loaded pages ── تحميل كل صفحة فقط عند الحاجة لتسريع أول تحميل
const Login = lazy(() => import("@/pages/Login"));
const ExecutiveDashboard2027 = lazy(() => import("@/pages/ExecutiveDashboard2027"));
const EvaluationRules2027 = lazy(() => import("@/pages/EvaluationRules2027"));
const QuarterlyIncentives2027 = lazy(() => import("@/pages/QuarterlyIncentives2027"));
const OperationsCenter2027 = lazy(() => import("@/pages/OperationsCenter2027"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerImport = lazy(() => import("@/pages/CustomerImport"));
const CustomerService = lazy(() => import("@/pages/CustomerService"));
const CustomerRequests = lazy(() => import("@/pages/CustomerRequests"));
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
const Accessories = lazy(() => import("@/pages/Accessories"));
const Offers = lazy(() => import("@/pages/Offers"));
const Stories = lazy(() => import("@/pages/Stories"));
const Training = lazy(() => import("@/pages/Training"));
const WhatsappAnalytics = lazy(() => import("@/pages/WhatsappAnalytics"));
const NotFound = lazy(() => import("@/pages/NotFound"));

// ── مكوّن التحميل المشترك ───────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center" dir="rtl">
      <div className="flex flex-col items-center gap-4">
        <img
          src={LOGO_URL}
          alt="دواء"
          className="w-16 h-16 rounded-2xl object-contain animate-pulse-soft"
        />
        <div className="w-8 h-8 border-3 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
        <div className="text-slate-400 text-sm">جارٍ التحميل...</div>
      </div>
    </div>
  );
}

// ── Protected Route ──────────────────────────────────────────────────────────
function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { user, loading, checkPermission } = useAuth();

  if (loading) return <PageLoader />;

  if (!user) return <Navigate to="/login" replace />;
  if (permission && !checkPermission(permission)) {
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

// ── Admin Route ──────────────────────────────────────────────────────────────
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

// ── Error Boundary ───────────────────────────────────────────────────────────
class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  state: { hasError: boolean; error?: Error } = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("App error boundary caught error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-navy-900 flex items-center justify-center p-6" dir="rtl">
          <div className="rounded-3xl border border-red-500/20 bg-slate-950/90 p-6 text-center text-slate-200 shadow-2xl max-w-md">
            <h1 className="text-2xl font-black text-white">حدث خطأ غير متوقع</h1>
            <p className="mt-3 text-slate-400">
              حدث خطأ أثناء عرض التطبيق. الرجاء إعادة تحميل الصفحة أو التحقق من الاتصال.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-6 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl transition-colors text-sm font-semibold"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AppErrorBoundary>
        <Toaster
          position="top-left"
          toastOptions={{
            style: {
              background: "#1B2B4B",
              border: "1px solid #2d4063",
              color: "#fff",
              fontFamily: "Cairo, sans-serif",
              direction: "rtl",
            },
          }}
          richColors
        />
        <PWABanner />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* ── Dashboard ── */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <ExecutiveDashboard2027 />
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
              path="/dashboard-classic"
              element={<Navigate to="/executive-2027" replace />}
            />

            {/* ── Admin & Management ── */}
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
              path="/penalty-incentive"
              element={
                <ProtectedRoute>
                  <AdminRoute>
                    <PenaltyIncentiveManagement />
                  </AdminRoute>
                </ProtectedRoute>
              }
            />

            {/* ── Customers ── */}
            <Route
              path="/customers"
              element={
                <ProtectedRoute>
                  <Customers />
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

            {/* ── Staff & Schedule ── */}
            <Route
              path="/team"
              element={
                <ProtectedRoute>
                  <Team />
                </ProtectedRoute>
              }
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
              path="/schedule"
              element={
                <ProtectedRoute>
                  <Schedule />
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
              path="/shift-notes"
              element={
                <ProtectedRoute>
                  <ShiftNotes />
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

            {/* ── Points & Incentives ── */}
            <Route
              path="/points"
              element={
                <ProtectedRoute>
                  <Points />
                </ProtectedRoute>
              }
            />

            {/* ── Dashboards ── */}
            <Route
              path="/doctor-dashboard"
              element={
                <ProtectedRoute>
                  <DoctorDashboard />
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

            {/* ── Analytics & Reports ── */}
            <Route
              path="/analytics"
              element={
                <ProtectedRoute>
                  <Analytics />
                </ProtectedRoute>
              }
            />
            <Route
              path="/invoices"
              element={
                <ProtectedRoute>
                  <AdminRoute>
                    <Invoices />
                  </AdminRoute>
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
              path="/reviews"
              element={
                <ProtectedRoute>
                  <Reviews />
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

            {/* ── Pharmacy & Inventory ── */}
            <Route
              path="/stagnant-medicines"
              element={
                <ProtectedRoute>
                  <StagnantMedicines />
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

            {/* ── Delivery ── */}
            <Route
              path="/delivery"
              element={
                <ProtectedRoute>
                  <Delivery />
                </ProtectedRoute>
              }
            />

            {/* ── Content & Marketing ── */}
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
              element={<Navigate to="/offers" replace />}
            />

            {/* ── Training ── */}
            <Route
              path="/training"
              element={
                <ProtectedRoute>
                  <Training />
                </ProtectedRoute>
              }
            />

            {/* ── 404 ── */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AppErrorBoundary>
    </BrowserRouter>
  );
}
