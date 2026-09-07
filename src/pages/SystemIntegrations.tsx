import { Activity, ShieldCheck } from 'lucide-react';
import AttendanceSyncCommandCenter from '@/components/attendance/AttendanceSyncCommandCenter';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import { canSeeAllBranches } from '@/lib/security/permissionScopes';
import { normalizeBranchName } from '@/lib/branch';

export default function SystemIntegrations() {
  const { user } = useAuth();
  const canAllBranches = canSeeAllBranches(user?.role);
  const normalizedBranch = normalizeBranchName(user?.branch || '');
  const defaultBranch = canAllBranches ? 'الكل' : normalizedBranch || 'الكل';
  const branches = ['الكل', ...BRANCHES.filter((branch) => branch !== 'الكل')];

  return (
    <div className="space-y-4" dir="rtl">
      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[var(--dawaa-theme-heading)]">
              <Activity size={22} />
              <h1 className="text-xl font-black">مركز المزامنة والتكاملات</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-7 text-[var(--dawaa-theme-muted)]">
              متابعة مستقلة لصحة مزامنة طلبات العملاء وفواتير المشتريات والبصمات، بعيدًا عن تقارير الحضور والموارد البشرية.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft px-3 py-2 text-xs font-black text-[var(--dawaa-theme-muted)]">
            <ShieldCheck size={16} />
            للإدارة المصرح لها فقط
          </div>
        </div>
      </section>

      <AttendanceSyncCommandCenter branches={branches} defaultBranch={defaultBranch} />
    </div>
  );
}
