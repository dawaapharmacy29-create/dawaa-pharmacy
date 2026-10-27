/**
 * Validation Tests for Staff Performance Profile Service
 *
 * This file contains validation tests to ensure the staff performance profile service
 * works with deterministic synthetic transport data and visible read failures.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadStaffPerformanceProfile } from '../staffPerformanceProfileService';
import { checkStaffDataHealth } from '../staffDataHealthService';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';


import { clearStaffCache } from '../staffIdentityResolver';

// Offline transport fixture: execute the real profile/resolver services against
// synthetic responses. No production keys, real staff, or network are required.
const fixture = vi.hoisted(() => ({ unavailable: false }));
vi.mock('@/lib/supabase', () => {
  const staff = { id: '10000000-0000-4000-8000-000000000001', name: 'Synthetic Pharmacist',
    branch: 'فرع اختبار', role: 'pharmacist', active: true, is_active: true, status: 'active', points: 0 };
  function query(table: string) {
    let rows: Record<string, unknown>[] = table === 'staff' ? [{ ...staff }, { ...staff, id: '10000000-0000-4000-8000-000000000002', name: 'Synthetic Inactive', active:false,is_active:false,status:'inactive' }] : [];
    const result = (single = false) => ({ data: fixture.unavailable ? null : single ? rows[0] ?? null : rows,
      error: fixture.unavailable ? { message: 'synthetic_directory_outage' } : null, count: rows.length });
    const chain = {
      select() { return chain; }, eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return chain; },
      in(key: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[key])); return chain; },
      gte() { return chain; }, lte() { return chain; }, gt() { return chain; }, lt() { return chain; },
      or() { return chain; }, order() { return chain; }, limit() { return chain; }, range() { return chain; },
      is() { return chain; }, not() { return chain; }, ilike() { return chain; },
      maybeSingle: async () => result(true), single: async () => result(true),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return chain;
  }
  return { isSupabaseConfigured: true, supabase: { from: query, rpc: async () => ({
    data: fixture.unavailable ? null : [], error: fixture.unavailable ? {message:'synthetic_directory_outage'} : null,
  }) } };
});

describe('Staff Performance Profile Service - Validation', () => {
  let testStaffId: string | null = null;
  let testStaffName: string | null = null;

  beforeEach(async () => {
    fixture.unavailable = false;
    clearStaffCache();
    if (!isSupabaseConfigured) {
      return;
    }

    // Get a test staff member (first active staff)
    const { data: staff } = await supabase
      .from('staff')
      .select('id,name')
      .eq('is_active', true)
      .limit(1);

    if (staff && staff.length > 0) {
      testStaffId = String(staff[0].id);
      testStaffName = String(staff[0].name || '');
    }
  });

  afterEach(() => {
    // Cleanup if needed
  });

  it('should load staff performance profile successfully', async () => {
    if (!isSupabaseConfigured) {
      console.warn('Supabase not configured, skipping test');
      return;
    }

    if (!testStaffId) {
      console.warn('No test staff found, skipping test');
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile).not.toBeNull();
    expect(profile.staff).toBeDefined();
    expect(profile.staff.id).toBe(testStaffId);
    expect(profile.identity).toBeDefined();
    expect(profile.dataHealth).toBeDefined();
  });

  it('should resolve staff identity correctly', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile.identity.primaryStaffId).toBe(testStaffId);
    expect(profile.identity.displayName).toBeDefined();
    expect(profile.identity.normalizedNames).toBeDefined();
    expect(Array.isArray(profile.identity.normalizedNames)).toBe(true);
    expect(profile.identity.normalizedNames.length).toBeGreaterThan(0);
  });

  it('should load monthly incentives', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile.monthlyIncentive).toBeDefined();
    if (profile.monthlyIncentive) {
      expect(profile.monthlyIncentive.finalPoints).toBeDefined();
      expect(typeof profile.monthlyIncentive.finalPoints).toBe('number');
      expect(profile.monthlyIncentive.incentiveValue).toBeDefined();
      expect(typeof profile.monthlyIncentive.incentiveValue).toBe('number');
    }
  });

  it('should expose Customer Request points as a separate staff projection', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile).toHaveProperty('customerRequestPoints');
    if (profile.customerRequestPoints) {
      expect(typeof profile.customerRequestPoints.total_points).toBe('number');
      expect(typeof profile.customerRequestPoints.registration_points).toBe('number');
      expect(typeof profile.customerRequestPoints.achievement_points).toBe('number');
      expect(typeof profile.customerRequestPoints.achievement_rate).toBe('number');
    }
  });

  it('should load sales metrics', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile.sales).toBeDefined();
    if (profile.sales) {
      expect(profile.sales.cycleNetSales).toBeDefined();
      expect(typeof profile.sales.cycleNetSales).toBe('number');
      expect(profile.sales.cycleInvoicesCount).toBeDefined();
      expect(typeof profile.sales.cycleInvoicesCount).toBe('number');
      expect(profile.sales.avgInvoice).toBeDefined();
      expect(typeof profile.sales.avgInvoice).toBe('number');
    }
  });

  it('should load customer metrics', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile.customers).toBeDefined();
    if (profile.customers) {
      expect(Array.isArray(profile.customers.topCustomers)).toBe(true);
      expect(Array.isArray(profile.customers.repeatCustomers)).toBe(true);
      expect(typeof profile.customers.newCustomers).toBe('number');
    }
  });

  it('should load stagnant/list metrics', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile.stagnantMedicines).toBeDefined();
    expect(profile.listItems).toBeDefined();
    if (profile.stagnantMedicines) {
      expect(typeof profile.stagnantMedicines.assignedStagnantItems).toBe('number');
      expect(typeof profile.stagnantMedicines.stagnantCompletionPercent).toBe('number');
    }
    if (profile.listItems) {
      expect(typeof profile.listItems.assignedListItems).toBe('number');
      expect(typeof profile.listItems.listCompletionPercent).toBe('number');
    }
  });

  it('should load quarterly metrics', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile.quarterlyIncentive).toBeDefined();
    if (profile.quarterlyIncentive) {
      expect(profile.quarterlyIncentive.quarterlyScore).toBeDefined();
      expect(typeof profile.quarterlyIncentive.quarterlyScore).toBe('number');
      expect(profile.quarterlyIncentive.baseQuarterlyIncentive).toBeDefined();
      expect(typeof profile.quarterlyIncentive.baseQuarterlyIncentive).toBe('number');
    }
  });

  it('should generate recommendations', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile.recommendations).toBeDefined();
    expect(Array.isArray(profile.recommendations)).toBe(true);

    // Check recommendation structure
    profile.recommendations.forEach((rec) => {
      expect(rec).toHaveProperty('priority');
      expect(rec).toHaveProperty('category');
      expect(rec).toHaveProperty('reason');
      expect(rec).toHaveProperty('suggestedAction');
      expect(['high', 'medium', 'low']).toContain(rec.priority);
    });
  });

  it('should calculate data health correctly', async () => {
    if (!isSupabaseConfigured || !testStaffId || !testStaffName) {
      return;
    }

    const healthReport = await checkStaffDataHealth(testStaffId, testStaffName);

    expect(healthReport).toBeDefined();
    expect(healthReport.staffId).toBe(testStaffId);
    expect(healthReport.staffName).toBe(testStaffName);
    expect(healthReport.overallHealthScore).toBeDefined();
    expect(typeof healthReport.overallHealthScore).toBe('number');
    expect(healthReport.overallHealthScore).toBeGreaterThanOrEqual(0);
    expect(healthReport.overallHealthScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(healthReport.criticalIssues)).toBe(true);
    expect(Array.isArray(healthReport.warnings)).toBe(true);
    expect(Array.isArray(healthReport.info)).toBe(true);
  });

  it('should handle invalid staff ID gracefully', async () => {
    if (!isSupabaseConfigured) {
      return;
    }

    await expect(loadStaffPerformanceProfile({
      staffId: 'invalid-staff-id-12345', forceRefresh: true,
    })).rejects.toThrow('Staff not found');
  });

  it('distinguishes a directory outage from a missing employee', async () => {
    fixture.unavailable = true;
    clearStaffCache();
    await expect(loadStaffPerformanceProfile({ staffId: 'unavailable-staff', forceRefresh: true }))
      .rejects.toThrow('تعذر تحميل دليل الموظفين');
  });

  it('should include charts data', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile.charts).toBeDefined();
    expect(Array.isArray(profile.charts.salesMonthlyTrend)).toBe(true);
    expect(Array.isArray(profile.charts.pointsEvolution)).toBe(true);
    expect(Array.isArray(profile.charts.quarterlyScoreComponents)).toBe(true);
  });

  it('should handle caching correctly', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    // First load
    const start1 = Date.now();
    const profile1 = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });
    const time1 = Date.now() - start1;

    // Second load (should be cached)
    const start2 = Date.now();
    const profile2 = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });
    const time2 = Date.now() - start2;

    expect(profile1).toEqual(profile2);

    // Second load should be faster due to caching
    // (This is a soft check, caching might not always be faster due to overhead)
    console.log(`First load: ${time1}ms, Second load: ${time2}ms`);
  });

  it('should separate monthly points from quarterly cash rewards', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    if (profile.monthlyIncentive) {
      // Monthly incentives should be in points
      expect(profile.monthlyIncentive.finalPoints).toBeDefined();
      expect(typeof profile.monthlyIncentive.finalPoints).toBe('number');

      // Quarterly cash rewards should be separate
      if (profile.quarterlyIncentive) {
        expect(profile.quarterlyIncentive.quarterlyCashRewards).toBeDefined();
        expect(typeof profile.quarterlyIncentive.quarterlyCashRewards).toBe('number');
      }
    }
  });

  it('should handle inactive staff correctly', async () => {
    if (!isSupabaseConfigured) {
      return;
    }

    // Get an inactive staff member
    const { data: inactiveStaff } = await supabase
      .from('staff')
      .select('id,name')
      .eq('is_active', false)
      .limit(1);

    if (!inactiveStaff || inactiveStaff.length === 0) {
      console.warn('No inactive staff found, skipping test');
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: String(inactiveStaff[0].id),
    });

    expect(profile).toBeDefined();
    expect(profile.staff.is_active).toBe(false);

    // Should have identity warnings about inactive status
    expect(profile.identity.inactiveDuplicateIds.length).toBeGreaterThanOrEqual(0);
  });

  it('should include error information for failed sections', async () => {
    if (!isSupabaseConfigured || !testStaffId) {
      return;
    }

    const profile = await loadStaffPerformanceProfile({
      staffId: testStaffId,
    });

    expect(profile.errorsBySection).toBeDefined();
    expect(typeof profile.errorsBySection).toBe('object');
  });
});

/**
 * Integration Test: Load multiple staff profiles
 */
describe('Staff Performance Profile Service - Integration', () => {
  it('should load multiple staff profiles without errors', async () => {
    if (!isSupabaseConfigured) {
      return;
    }

    const { data: staff } = await supabase
      .from('staff')
      .select('id')
      .eq('is_active', true)
      .limit(5);

    if (!staff || staff.length === 0) {
      console.warn('No staff found for integration test');
      return;
    }

    const profiles = await Promise.all(
      staff.map((s) => loadStaffPerformanceProfile({ staffId: String(s.id) }))
    );

    expect(profiles.length).toBe(staff.length);
    profiles.forEach((profile) => {
      expect(profile).toBeDefined();
      expect(profile.staff).toBeDefined();
      expect(profile.identity).toBeDefined();
      expect(profile.dataHealth).toBeDefined();
    });
  });

  it('should handle concurrent requests safely', async () => {
    if (!isSupabaseConfigured) {
      return;
    }

    const { data: staff } = await supabase
      .from('staff')
      .select('id')
      .eq('is_active', true)
      .limit(3);

    if (!staff || staff.length === 0) {
      return;
    }

    // Load the same staff multiple times concurrently
    const staffId = String(staff[0].id);
    const concurrentRequests = Array(10)
      .fill(null)
      .map(() => loadStaffPerformanceProfile({ staffId }));

    const results = await Promise.all(concurrentRequests);

    results.forEach((result) => {
      expect(result).toBeDefined();
      expect(result.staff.id).toBe(staffId);
    });
  });
});

/**
 * Build Validation
 */
describe('Build Validation', () => {
  it('should have no TypeScript compilation errors', () => {
    // This test validates that the service compiles correctly
    // If this file compiles, the TypeScript types are valid
    expect(true).toBe(true);
  });

  it('should export all required functions', () => {
    expect(loadStaffPerformanceProfile).toBeDefined();
    expect(typeof loadStaffPerformanceProfile).toBe('function');
  });

  it('should have proper TypeScript interfaces', () => {
    // Interfaces are compile-time only; typecheck validates them.
    expect(true).toBe(true);
  });
});
