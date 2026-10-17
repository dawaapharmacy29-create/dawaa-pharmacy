import SalesIntelligenceOpportunityCenterV1 from './SalesIntelligenceOpportunityCenterV1';
import { pharmacyCycleForDateV1 } from '@/lib/salesIntelligence/dashboardScopeV1';

export default function ProductDemandLeakageV22({cycleStart,branch}:{cycleStart:string;branch:string}) {
  return <SalesIntelligenceOpportunityCenterV1 cycle={pharmacyCycleForDateV1(cycleStart)} branch={branch} />;
}
