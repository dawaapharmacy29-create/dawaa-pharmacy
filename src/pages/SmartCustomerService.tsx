import CustomerServiceModalSafety from '@/components/customerService/CustomerServiceModalSafety';
import CustomerServiceSmartLayer from '@/components/customerService/CustomerServiceSmartLayer';
import CustomerServiceClassic from './CustomerService';

// Keep the established customer-service page and restore the stable smart layer above it.
// The full classic page remains underneath with reports, CSV exports, scripts, reviews, history, and analytics.
export default function SmartCustomerService() {
  return (
    <div className="customer-service-page smart-customer-service-shell" dir="rtl">
      <CustomerServiceModalSafety />
      <CustomerServiceSmartLayer />
      <CustomerServiceClassic />
    </div>
  );
}
