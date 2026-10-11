import { describe, expect, it } from 'vitest';
import { roleTaskEvidenceApplicabilityConfigured, taskEvidenceSourcesForRole } from '@/lib/performance/performanceEvidenceApplicability';

describe('performance evidence applicability',()=>{
  it('keeps role evidence sources explicit rather than inferred from outages',()=>{
    expect(taskEvidenceSourcesForRole('doctor')).toContain('customer_followup');
    expect(taskEvidenceSourcesForRole('delivery')).not.toContain('customer_followup');
    expect(taskEvidenceSourcesForRole('inventory_assistant')).toContain('shelf_task');
    expect(taskEvidenceSourcesForRole('cleaning')).toContain('cleaning_task');
  });
  it('fails closed for generic unknown roles',()=>{
    expect(taskEvidenceSourcesForRole('other')).toEqual([]);
    expect(roleTaskEvidenceApplicabilityConfigured('other')).toBe(false);
  });
});
