import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const root = new URL('../../../../', import.meta.url);
describe('official KPI readers cannot return to legacy sales truth', () => {
  it.each([
    'src/lib/evaluations/doctorPerformanceIntelligenceService.ts',
    'src/pages/WhatsappAnalytics.tsx',
    'src/components/salesIntelligence/SalesIntelligenceManagementOverviewV1.tsx',
    'src/components/salesIntelligence/SalesIntelligenceStaffPerformanceV1.tsx',
    'src/components/salesIntelligence/SalesIntelligenceOpportunityCenterV1.tsx',
  ])('%s does not query legacy proof-only KPI sources', (file) => {
    const code = readFileSync(new URL(file, root), 'utf8');
    expect(code).not.toMatch(
      /\.from\(['"](?:whatsapp_doctor_cycle_intelligence_v1|sales_intelligence_invoice_staff_truth_v1|whatsapp_sales_leakage_monthly_v22|whatsapp_product_demand_detail_v22)['"]\)/
    );
    expect(code).not.toMatch(/invoice_match_status\s*===\s*['"]verified['"]/);
  });
  it.each([
    'WhatsAppDoctorPerformance',
    'WhatsAppBranchComparison',
    'WhatsAppLostOpportunities',
    'WhatsAppCustomerHistory',
  ])('%s is retired without querying its historical RPC', (name) => {
    const code = readFileSync(new URL(`src/pages/${name}.tsx`, root), 'utf8');
    expect(code).not.toMatch(/\.rpc\(/);
    expect(code).toContain('LegacySurfaceNotice');
  });
});
