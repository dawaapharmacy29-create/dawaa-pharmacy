import SidebarBase from '@/components/layout/SidebarBase';
import { ROLE_PERMISSION_PRESETS, ROUTE_PERMISSION_MAP } from '@/lib/core/permissionSystem';

// مركز المهام والتنبيهات مساحة ذاتية لكل موظف. نمنح view_operations لكل دور
// حتى يظهر الرابط ويمر RouteGuard، مع إبقاء صفحات التشغيل الإدارية الأخرى
// خلف صلاحياتها المتخصصة حتى لا يؤدي فتح المركز إلى توسيع نطاق الوصول لها.
for (const permissions of Object.values(ROLE_PERMISSION_PRESETS)) {
  if (!permissions.includes('*') && !permissions.includes('view_operations')) {
    permissions.push('view_operations');
  }
}

ROUTE_PERMISSION_MAP['/operations-center'] = 'view_operations';
ROUTE_PERMISSION_MAP['/accessories'] = ['view_inventory', 'manage_operations'];
ROUTE_PERMISSION_MAP['/offers'] = 'manage_operations';
ROUTE_PERMISSION_MAP['/stories'] = 'manage_operations';
ROUTE_PERMISSION_MAP['/training'] = 'manage_operations';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar(props: SidebarProps) {
  return <SidebarBase {...props} />;
}
