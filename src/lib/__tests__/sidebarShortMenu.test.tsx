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
    expect(html).toContain('بحث العملاء');
    expect(html).not.toContain('العملاء والمحادثات');
  });

  it('opens top management on a short menu, with the rest one click away', () => {
    const html = menu('branches_manager');
    expect(html).toContain('النقاط والأداء');
    expect(html).toContain('دليل الموظفين');
    expect(html).toContain('كل الصفحات');
    expect(html).not.toContain('إعدادات الموارد البشرية');
  });

  it('shows the review pages to the general manager and to nobody else', () => {
    expect(menu('general_manager')).toContain('صفحات للمراجعة');
    const everything = Object.fromEntries(['view_reviews', 'view_team', 'view_customer_service'].map((key) => [key, true]));
    for (const role of ['executive_manager', 'branches_manager', 'branch_manager', 'pharmacist', 'delivery']) {
      expect(menu(role, everything)).not.toContain('صفحات للمراجعة');
    }
    vi.stubGlobal('window', { location: { pathname: '/', search: '' } });
    expect(menu('assistant', everything)).not.toContain('صفحات للمراجعة');
    expect(menu('team_dawaa_alpha', everything)).not.toContain('صفحات للمراجعة');
    vi.unstubAllGlobals();
  });

  it('keeps assistants and Team Dawaa Alpha on the assistant menu', () => {
    vi.stubGlobal('window', { location: { pathname: '/', search: '' } });
    expect(menu('assistant')).toContain('مساحة المساعد التشغيلية');
    expect(menu('team_dawaa_alpha')).toContain('مساحة المساعد التشغيلية');
    vi.unstubAllGlobals();
  });
});
