import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '@/components/layout/Sidebar';
import { hasPermission } from '@/lib/core/permissionSystem';

const auth = vi.hoisted(() => ({
  current: {
    role: 'pharmacist',
    permissions: {} as Record<string, boolean>,
    staffId: 'someone',
    id: 'x',
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: auth.current,
    logout: () => undefined,
    checkPermission: (permission: string) => hasPermission(auth.current, permission),
  }),
}));
vi.mock('@/hooks/usePendingShiftNotesCount', () => ({ usePendingShiftNotesCount: () => 0 }));

const menu = (role: string, permissions: Record<string, boolean> = {}, staffId = 'someone') => {
  auth.current = { role, permissions, staffId, id: 'x' };
  return renderToStaticMarkup(
    <MemoryRouter>
      <Sidebar
        collapsed={false}
        onToggle={() => undefined}
        mobileOpen={false}
        onMobileClose={() => undefined}
      />
    </MemoryRouter>
  );
};

describe('the sidebar each role really gets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives a branch manager the short menu, not the whole application', () => {
    const html = menu('branch_manager');
    expect(html).toContain('فريقي');
    expect(html).not.toContain('الرواتب والنقاط والحوافز');
  });

  it('gives a pharmacist the short menu', () => {
    const html = menu('pharmacist');
    expect(html).toContain('أدائي وحافزي');
    expect(html).not.toContain('العملاء والمحادثات');
  });

  it('leaves the managers above a branch on the full menu', () => {
    const html = menu('branches_manager');
    expect(html).toContain('الرواتب والنقاط والحوافز');
    expect(html).not.toContain('فريقي');
  });

  it('keeps assistants and Team Dawaa Alpha on the assistant menu', () => {
    expect(menu('assistant')).toContain('مساحة المساعد التشغيلية');
    expect(menu('team_dawaa_alpha')).toContain('مساحة المساعد التشغيلية');
  });
});
