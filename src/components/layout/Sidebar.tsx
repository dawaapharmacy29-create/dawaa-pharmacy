import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import SidebarBase from '@/components/layout/SidebarBase';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar(props: SidebarProps) {
  const { user } = useAuth();
  const customerServiceManager = normalizeRole(user?.role) === 'customer_service_manager';
  return <>
    {customerServiceManager ? <style>{`
      a[href="/branch-checklist-review"] { display: none !important; }
      a[href="/staff-monthly-evaluation"] { font-size: 0 !important; }
      a[href="/staff-monthly-evaluation"]::after { content: "تقييم خدمة العملاء للدكاترة"; font-size: 14px; font-weight: 800; }
    `}</style> : null}
    <SidebarBase {...props} />
  </>;
}
