import CustomerServiceOperationsPanel from '@/components/customerService/CustomerServiceOperationsPanel';
import UnifiedCustomerServiceWorkspace from '@/components/customerService/UnifiedCustomerServiceWorkspace';

export default function SmartCustomerService() {
  return (
    <div className="customer-service-page" dir="rtl">
      <CustomerServiceOperationsPanel />
      <UnifiedCustomerServiceWorkspace />
    </div>
  );
}
