import CustomerRequestsV2 from '@/pages/CustomerRequestsV2';

/**
 * Canonical Customer Requests entrypoint.
 *
 * The temporary legacy fallback was intentionally retired after V2 reached
 * operational parity. Keeping one routed implementation prevents duplicate
 * write paths and keeps the atomic command boundary authoritative.
 */
export default function CustomerRequests() {
  return <CustomerRequestsV2 />;
}
