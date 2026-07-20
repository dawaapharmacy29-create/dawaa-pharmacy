import CustomerFollowupFullExportPanel from '@/components/customerService/CustomerFollowupFullExportPanel';
import CustomerServiceDataTools from '@/components/customerService/CustomerServiceDataTools';
import CustomerServiceOperationsPanel from '@/components/customerService/CustomerServiceOperationsPanel';
import CustomerServiceScriptEditor from '@/components/customerService/CustomerServiceScriptEditor';
import UnifiedCustomerServiceWorkspace from '@/components/customerService/UnifiedCustomerServiceWorkspace';

export default function SmartCustomerService() {
  return (
    <div className="customer-service-page" dir="rtl">
      <CustomerFollowupFullExportPanel />
      <CustomerServiceDataTools />
      <CustomerServiceScriptEditor />
      <CustomerServiceOperationsPanel />
      <UnifiedCustomerServiceWorkspace />
    </div>
  );
}
