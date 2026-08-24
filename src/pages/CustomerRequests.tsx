import { useSearchParams } from 'react-router-dom';
import CustomerRequestsV2 from '@/pages/CustomerRequestsV2';
import CustomerRequestsLegacy from '@/pages/CustomerRequestsLegacy';

/**
 * Branch rollout switch:
 * - /customer-requests => new canonical operations workspace
 * - /customer-requests?legacy=1 => preserved legacy page for parity checks
 *
 * This switch exists only on the refactor branch until rollout verification is complete.
 */
export default function CustomerRequests() {
  const [searchParams] = useSearchParams();
  if (searchParams.get('legacy') === '1') return <CustomerRequestsLegacy />;
  return <CustomerRequestsV2 />;
}
