import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { ROLES } from '@/lib/core/permissionSystem';
import { getPermissionScopeForRole, getVisibleSectionsForPath } from '@/lib/permissionMatrix';

interface PermissionGateProps {
  permission?: string;
  anyOf?: string[];
  allOf?: string[];
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * يُخفي المحتوى إذا لم يكن المستخدم يملك الصلاحيات المطلوبة.
 * - permission: صلاحية واحدة مطلوبة
 * - anyOf: يكفي أي صلاحية من القائمة
 * - allOf: كل الصلاحيات مطلوبة
 */
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

export function SectionDenied({
  message = 'هذا الجزء غير متاح لهذا الحساب.',
}: {
  message?: string;
}) {
  return (
    <div
      className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100"
      dir="rtl"
    >
      {message}
    </div>
  );
}

export function PermissionScopeBadge() {
  const { user } = useAuth();
  const scope = getPermissionScopeForRole(user?.role);
  return (
    <span className="inline-flex items-center rounded-full border border-teal-500/20 bg-teal-500/10 px-2.5 py-1 text-xs font-semibold text-teal-100">
      نطاق البيانات: {scope.description}
    </span>
  );
}

export function RoleBadge() {
  const { user } = useAuth();
  const roleDef = ROLES.find((r) => r.key === user?.role);
  if (!roleDef) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-200">
      {roleDef.labelAr}
    </span>
  );
}

export function PageSectionsPreview({ path }: { path: string }) {
  const { checkPermission } = useAuth();
  const sections = getVisibleSectionsForPath(path, checkPermission);
  if (!sections.length) return null;
  return (
    <div className="mb-4 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-3" dir="rtl">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-400">
        <span>الأقسام المتاحة لحسابك داخل هذه الصفحة</span>
        <PermissionScopeBadge />
      </div>
      <div className="flex flex-wrap gap-2">
        {sections.map((section) => (
          <span
            key={section.key}
            className="rounded-full bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-100"
          >
            {section.label}
          </span>
        ))}
      </div>
    </div>
  );
}
