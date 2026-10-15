import SidebarBase from '@/components/layout/SidebarBase';
import AssistantSidebar from '@/components/layout/AssistantSidebar';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar(props: SidebarProps) {
  const { user } = useAuth();
  if (normalizeRole(user?.role) === 'assistant') {
    return <AssistantSidebar {...props} />;
  }
  return <SidebarBase {...props} />;
}
