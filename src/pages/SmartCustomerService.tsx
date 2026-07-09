import CustomerServiceClassic from './CustomerService';

// The smart experiment was useful for prioritization, but the production /customer-service page
// must keep every feature from the established customer-service command center: tabs, audit exports,
// quick followups, history, scripts, performance analytics, data review, and result editing.
// Keep this wrapper so the route can remain stable while we integrate the smart queue into the
// existing page incrementally instead of replacing it and losing features.
export default function SmartCustomerService() {
  return <CustomerServiceClassic />;
}
