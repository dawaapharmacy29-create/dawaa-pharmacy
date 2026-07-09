import CustomerServiceSmartLayer from '@/components/customerService/CustomerServiceSmartLayer';
import CustomerServiceClassic from './CustomerService';

// Keep all established customer-service features, then add a smart operating layer above them.
// This gives customer-service doctors a prioritized work queue, source mix, alerts, and quick jumps
// while preserving the classic tabs, reports, CSV exports, scripts, result editing, and history.
export default function SmartCustomerService() {
  return (
    <div className="customer-service-page smart-customer-service-shell" dir="rtl">
      <CustomerServiceSmartLayer />
      <CustomerServiceClassic />
    </div>
  );
}
