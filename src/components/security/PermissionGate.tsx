import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getRoleDefinition, ROLES } from '@/lib/core/permissionSystem';
import { getVisibleSectionsForPath } from '@/lib/permissionMatrix';

interface PermissionGateProps {
  permission?: string;
  anyOf?: string[];
  allOf?: string[];
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({
  permission,
  anyOf,
  allOf,
  fallback = null,
  children,
}: PermissionGateProps) {
  const { checkPermission } = useAuth();
  const allowed =
    (!permission || checkPermission(permission)) &&
    (!anyOf?.length || anyOf.some((p) => checkPermission(p))) &&
    (!allOf?.length || allOf.every((p) => checkPermission(p)));
  return allowed ? <>{children}</> : <>{fallback}</>;
}

export function SectionDenied({ message = 'هذا الجزء غير متاح لهذا الحساب.' }: { message?: string }) {
  return (
    <div
      className="rounded-2xl border p-4 text-sm font-bold"
      style={{
        borderColor: 'var(--dawaa-status-warning-border)',
        background: 'var(--dawaa-status-warning-bg)',
        color: 'var(--dawaa-status-warning-text)',
      }}
      dir="rtl"
    >
      {message}
    </div>
  );
}

export function PermissionScopeBadge() {
  const { user } = useAuth();
  const roleDef = getRoleDefinition(user?.role);
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black"
      style={{
        borderColor: 'var(--dawaa-theme-accent-border)',
        background: 'var(--dawaa-theme-accent-soft)',
        color: 'var(--dawaa-theme-primary-strong)',
      }}
    >
      نطاق البيانات: {roleDef.description}
    </span>
  );
}

export function RoleBadge() {
  const { user } = useAuth();
  const roleDef = ROLES.find((r) => r.key === user?.role);
  if (!roleDef) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-black"
      style={{
        borderColor: 'var(--dawaa-status-info-border)',
        background: 'var(--dawaa-status-info-bg)',
        color: 'var(--dawaa-status-info-text)',
      }}
    >
      {roleDef.labelAr}
    </span>
  );
}

export function PageSectionsPreview({ path }: { path: string }) {
  const { user, checkPermission } = useAuth();
  if (!user) return null;
  const sections = getVisibleSectionsForPath(path, checkPermission);
  if (!sections.length) return null;
  return (
    <div
      className="mb-4 rounded-2xl border p-3 shadow-sm"
      style={{
        borderColor: 'var(--dawaa-theme-border-strong)',
        background: 'var(--dawaa-theme-surface-raised)',
        color: 'var(--dawaa-theme-text)',
      }}
      dir="rtl"
    >
      <div
        className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-black"
        style={{ color: 'var(--dawaa-theme-heading)' }}
      >
        <span>الأقسام المتاحة لحسابك داخل هذه الصفحة</span>
        <PermissionScopeBadge />
      </div>
      <div className="flex flex-wrap gap-2">
        {sections.map((section) => (
          <span
            key={section.key}
            className="rounded-full border px-3 py-1 text-xs font-black shadow-sm"
            style={{
              borderColor: 'var(--dawaa-theme-accent-border)',
              background: 'var(--dawaa-theme-accent-soft)',
              color: 'var(--dawaa-theme-primary-strong)',
            }}
          >
            {section.label}
          </span>
        ))}
      </div>
    </div>
  );
}
