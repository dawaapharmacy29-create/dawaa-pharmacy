import { useState } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";

const PAGE_TITLES: Record<string, string> = {
  "/": "لوحة القيادة 2027",
  "/customers": "إدارة العملاء",
  "/customer-service": "مركز خدمة العملاء",
  "/customer-requests": "طلبات العملاء",
  "/team": "إدارة الفريق",
  "/schedule": "الجدول الأسبوعي",
  "/time-off": "الإذونات والإجازات",
  "/points": "النقاط والمكافآت",
  "/reviews": "تقييم المحادثات",
  "/shift-performance": "تقييم الشيفتات",
  "/doctor-dashboard": "لوحة الدكتور",
  "/stagnant-medicines": "الأدوية الرواكد",
  "/incentive-medicines": "أدوية اللستة",
  "/delivery": "التوصيل وتقييم الدليفري",
  "/analytics": "التحليلات والمبيعات",
  "/invoices": "استيراد الفواتير",
  "/staff-accounts": "حسابات الفريق",
  "/roles-permissions": "الأدوار والصلاحيات",
  "/activity-log": "سجل الأنشطة",
  "/penalty-incentive": "إدارة الجزاءات والحوافز",
  "/executive-2027": "لوحة القيادة 2027",
  "/evaluation-rules": "قواعد التقييم المرنة",
  "/quarterly-incentives": "الحافز الربع سنوي",
  "/operations-center": "المهام والتنبيهات",
  "/staff-dashboard": "لوحة تحكم الموظف",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || "صيدليات دواء";

  return (
    <div className="flex h-screen bg-navy-900 overflow-hidden" dir="rtl">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header onMobileMenuOpen={() => setMobileOpen(true)} title={title} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="animate-fade-in max-w-[1720px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
