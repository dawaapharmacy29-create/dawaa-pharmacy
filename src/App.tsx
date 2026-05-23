import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/layout/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import ExecutiveDashboard2027 from "@/pages/ExecutiveDashboard2027";
import EvaluationRules2027 from "@/pages/EvaluationRules2027";
import QuarterlyIncentives2027 from "@/pages/QuarterlyIncentives2027";
import OperationsCenter2027 from "@/pages/OperationsCenter2027";
import Customers from "@/pages/Customers";
import CustomerService from "@/pages/CustomerService";
import CustomerRequests from "@/pages/CustomerRequests";
import Team from "@/pages/Team";
import Schedule from "@/pages/Schedule";
import Points from "@/pages/Points";
import Delivery from "@/pages/Delivery";
import Analytics from "@/pages/Analytics";
import Invoices from "@/pages/Invoices";
import ActivityLog from "@/pages/ActivityLog";
import Reviews from "@/pages/Reviews";
import ShiftPerformance from "@/pages/ShiftPerformance";
import StaffDetail from "@/pages/StaffDetail";
import TimeOff from "@/pages/TimeOff";
import DoctorDashboard from "@/pages/DoctorDashboard";
import StagnantMedicines from "@/pages/StagnantMedicines";
import IncentiveMedicines from "@/pages/IncentiveMedicines";
import StaffAccounts from "@/pages/StaffAccounts";
import PenaltyIncentiveManagement from "@/pages/PenaltyIncentiveManagement";
import StaffDashboard from "@/pages/StaffDashboard";
import RolesPermissions from "@/pages/RolesPermissions";
import NotFound from "@/pages/NotFound";
import { LOGO_URL } from "@/lib/constants";
import PWABanner from "@/components/features/PWABanner";

function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { user, loading, checkPermission } = useAuth();

  if (loading) {
    return (
      <div
        className="min-h-screen bg-navy-900 flex items-center justify-center"
        dir="rtl"
      >
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

export default function App() {
  return (
    <BrowserRouter>
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
              <Dashboard />
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
          path="/customers"
          element={
            <ProtectedRoute>
              <Customers />
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
    </BrowserRouter>
  );
}
