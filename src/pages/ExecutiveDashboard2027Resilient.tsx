import ExecutiveDashboard2027 from '@/pages/ExecutiveDashboard2027';

/**
 * Runtime wrapper kept only for backwards-compatible lazy routing and section
 * resilience. Visual theming belongs to ExecutiveDashboard2027 and the shared
 * semantic theme system; this wrapper intentionally owns no palette or visual
 * override.
 */
export default function ExecutiveDashboard2027Resilient() {
  return (
    <div data-theme-runtime="executive-2027">
      <ExecutiveDashboard2027 />
    </div>
  );
}
