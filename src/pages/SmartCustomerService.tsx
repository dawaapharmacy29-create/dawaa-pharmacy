import CustomerServiceModalSafety from '@/components/customerService/CustomerServiceModalSafety';
import CustomerServiceOperatingCenterV2 from '@/components/customerService/CustomerServiceOperatingCenterV2';
import CustomerServiceClassic from './CustomerService';

// Keep the established customer-service page, but put a cleaner operating center above it.
// The center is intentionally focused: priority queue, customer file, caring script, and quick result.
export default function SmartCustomerService() {
  return (
    <div className="customer-service-page smart-customer-service-shell" dir="rtl">
      <CustomerServiceModalSafety />
      <CustomerServiceOperatingCenterV2 />
      <CustomerServiceClassic />
    </div>
  );
}
