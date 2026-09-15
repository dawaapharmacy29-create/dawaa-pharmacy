import { useEffect, useState } from 'react';
import { Wifi, WifiOff, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type BranchHealth = {
  branch: string;
  branch_sync_status: 'healthy' | 'delayed' | 'stale' | 'offline';
  watermark_reported_at: string | null;
  unmapped: number;
};

const STATUS_META: Record<string, { label: string; icon: typeof Wifi; className: string }> = {
  healthy: { label: 'متصل', icon: Wifi, className: 'text-[var(--dawaa-status-success-text)] bg-[var(--dawaa-status-success-bg)] border-[var(--dawaa-status-success-border)]' },
  delayed: { label: 'بطيء', icon: Clock, className: 'text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]' },
  stale: { label: 'متأخر', icon: AlertTriangle, className: 'text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]' },
  offline: { label: 'غير متصل', icon: WifiOff, className: 'text-[var(--dawaa-status-danger-text)] bg-[var(--dawaa-status-danger-bg)] border-[var(--dawaa-status-danger-border)]' },
};

function timeAgo(value: string | null) {
  if (!value) return 'لا يوجد';
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}

export default function AttendanceHealthStrip() {
  const [branches, setBranches] = useState<BranchHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase.rpc('attendance_sync_health_v2');
      if (!cancelled && data?.branch_breakdown) {
        const rows = (data.branch_breakdown as (BranchHealth & { events: number })[])
          .filter((b) => b.branch === 'فرع الشامي' || b.branch === 'فرع شكري');
        setBranches(rows);
      }
      if (!cancelled) setLoading(false);
    }
    void load();
    const id = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  if (loading) return <div className="h-10 animate-pulse rounded-xl bg-[var(--dawaa-theme-surface-2)] print:hidden" />;
  if (!branches.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {branches.map((b) => {
        const meta = STATUS_META[b.branch_sync_status] || STATUS_META.offline;
        const Icon = meta.icon;
        return (
          <div key={b.branch} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black', meta.className)}>
            <Icon size={13} />
            <span>{b.branch}</span>
            <span className="opacity-70">— {meta.label}</span>
            <span className="opacity-70">· آخر مزامنة {timeAgo(b.watermark_reported_at)}</span>
          </div>
        );
      })}
    </div>
  );
}
