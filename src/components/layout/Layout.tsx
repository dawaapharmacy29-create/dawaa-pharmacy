import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { PageSectionsPreview } from '@/components/security/PermissionGate';
import { NavigationGuardProvider } from '@/contexts/NavigationGuardContext';

const PAGE_TITLES: Record<string, string> = {
  '/': 'لوحة القيادة 2027',
  '/customers': 'إدارة العملاء',
  '/customer-service': 'مركز خدمة العملاء',
  '/customer-data-review': 'مراجعة بيانات العملاء',
  '/customer-welcome': 'الرسائل الترحيبية',
  '/quick-replies': 'اختصارات الردود السريعة',
  '/doctor-competition': 'مسابقة الدكاترة',
  '/customer-cashback': 'نقاط العملاء / الكاش باك',
  '/customer-service-credit': 'كريديت خدمة العملاء',
  '/customer-requests': 'طلبات العملاء',
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
  '/penalty-incentive': 'إدارة الجزاءات والحوافز',
  '/executive-2027': 'لوحة القيادة 2027',
  '/evaluation-rules': 'قواعد التقييم المرنة',
  '/quarterly-incentives': 'الحافز الربع سنوي',
  '/operations-center': 'المهام والتنبيهات',
  '/staff-dashboard': 'لوحة تحكم الموظف',
  '/medicine-expiry': 'متابعة صلاحية الأدوية',
  '/attendance-report': 'تقرير الحضور الشهري',
  '/loyalty-tiers': 'مستويات ولاء العملاء',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'صيدليات دواء';
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'dawaa_invoice_import_refresh' || !event.newValue) return;
      // لا نعمل reload كامل للتطبيق؛ نرسل حدث داخلي للصفحات التي تحتاج تحديث بياناتها فقط.
      window.dispatchEvent(
        new CustomEvent('dawaa:data-refresh', { detail: { source: 'invoice-import' } })
      );
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const key = `dawaa_scroll_${location.pathname}`;
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
  }, [location.pathname]);

  return (
    <NavigationGuardProvider>
      <div className="flex h-screen bg-navy-900 overflow-hidden" dir="rtl">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Header onMobileMenuOpen={() => setMobileOpen(true)} title={title} />
          <main ref={mainRef} className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="animate-fade-in max-w-[1720px] mx-auto">
              <PageSectionsPreview path={location.pathname} />
              {children}
            </div>
          </main>
        </div>
      </div>
    </NavigationGuardProvider>
  );
}
