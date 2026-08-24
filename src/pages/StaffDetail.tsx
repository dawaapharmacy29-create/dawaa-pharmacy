import { useParams } from 'react-router-dom';
import StaffDetailLegacy from '@/pages/StaffDetailLegacy';
import CustomerRequestDoctorPointsCard from '@/features/customer-requests/workspace/CustomerRequestDoctorPointsCard';

/**
 * Staff profile integration layer for the Customer Requests refactor.
 * The existing staff detail remains intact while the canonical Customer Request
 * points projection is added as one independent card sourced from the central ledger.
 */
export default function StaffDetail() {
  const { id } = useParams();
  return (
    <div className="space-y-4">
      <StaffDetailLegacy />
      {id ? <CustomerRequestDoctorPointsCard staffId={id} /> : null}
    </div>
  );
}
