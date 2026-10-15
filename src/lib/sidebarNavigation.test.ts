import { describe, expect, it } from 'vitest';
import { activeItem } from './sidebarNavigation';

describe('sidebar route identity', () => {
  it('distinguishes followup creation from the customer service workspace', () => {
    expect(activeItem('/customer-service', '/customer-service', '?quickFollowup=1')).toBe(false);
    expect(activeItem('/customer-service?quickFollowup=1', '/customer-service', '?quickFollowup=1')).toBe(true);
    expect(activeItem('/customer-service?quickFollowup=1', '/customer-service', '')).toBe(false);
  });
  it('matches the selected attendance tab while allowing report filters', () => {
    expect(activeItem('/attendance-report?tab=report', '/attendance-report', '?tab=report&branch=Shami')).toBe(true);
    expect(activeItem('/attendance-report?tab=daily', '/attendance-report', '?tab=report')).toBe(false);
  });
  it('keeps staff detail navigation in the employee directory', () => {
    expect(activeItem('/team', '/staff/123', '')).toBe(true);
    expect(activeItem('/', '/staff/123', '')).toBe(false);
    expect(activeItem('/points', '/point-appeals', '')).toBe(false);
  });
});
