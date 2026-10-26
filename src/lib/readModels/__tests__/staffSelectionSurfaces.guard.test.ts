import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The shared directory also contains login-account and spelling-alias evidence.
 * An operational employee picker must explicitly restrict that directory to
 * active canonical staff rows; otherwise an orphan account can become a person.
 */
const operationalPickers = [
  'src/pages/BranchInspection.tsx',
  'src/pages/DoctorPerformancePillars.tsx',
  'src/pages/HRStaffMilestones.tsx',
  'src/pages/OperationsCenter2027.tsx',
  'src/pages/PenaltyIncentiveManagement.tsx',
  'src/pages/RolesPermissions.tsx',
  'src/pages/ShiftNotes.tsx',
  'src/pages/StaffAccounts.tsx',
  'src/pages/StaffDetail.tsx',
  'src/pages/Stories.tsx',
  'src/pages/TimeOff.tsx',
  'src/pages/WhatsappAnalytics.tsx',
] as const;

describe('operational employee selection surfaces', () => {
  it('enforces canonical active staff centrally in the shared selection hook', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/hooks/useStaffDirectory.ts'), 'utf8');
    expect(source).toMatch(/canonicalActiveStaff\(await readStaffDirectory\(\)\)/);
  });

  it('keys the review-doctor filter by immutable staff identity, not names', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/reviews/ReviewsInsightsHub.tsx'), 'utf8');
    expect(source).toContain('resolveStaff(row).key !== doctor');
    expect(source).toContain('value={item.key}');
  });

  it.each(operationalPickers)('%s excludes aliases and login accounts', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source, `${file}: picker must use canonical staff rows only`)
      .toMatch(/\.source\s*(?:===\s*['"]staff['"]|!==\s*['"]staff['"])/);
    expect(source, `${file}: picker must require active staff`)
      .toMatch(/\.(?:active)\b/);
    expect(source, `${file}: an alias-only exclusion is insufficient`)
      .not.toMatch(/\.source\s*(?:===|!==)\s*['"]alias['"]/);
  });
});
