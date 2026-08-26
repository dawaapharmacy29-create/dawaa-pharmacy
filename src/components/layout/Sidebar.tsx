import SidebarBase from '@/components/layout/SidebarBase';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar(props: SidebarProps) {
  return <SidebarBase {...props} />;
}
