import CustomerServiceHealthPanel from '@/components/customerService/CustomerServiceHealthPanel';
import CustomerServiceManagerDashboardV3 from '@/pages/CustomerServiceManagerDashboardV3';
import '@/styles/dashboard-theme-scopes.css';

export default function CustomerServiceManagerDashboard() {
  return (
    <div className="customer-service-dashboard-theme" dir="rtl">
      <CustomerServiceHealthPanel />
      <CustomerServiceManagerDashboardV3 />
    </div>
  );
}
