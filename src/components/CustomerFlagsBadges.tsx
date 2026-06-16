import {
  getActiveCustomerFlags,
  getSeverityBadgeStyle,
  sortFlagsByPriority,
  type CustomerFlagsObject,
} from "@/lib/customerFlags";

interface CustomerFlagsBadgesProps {
  customerFlags: CustomerFlagsObject | any;
  limit?: number;
  showAll?: boolean;
  compact?: boolean;
}

export function CustomerFlagsBadges({
  customerFlags,
  limit = 3,
  showAll = false,
  compact = false,
}: CustomerFlagsBadgesProps) {
  const activeFlags = getActiveCustomerFlags(customerFlags);
  const sortedFlags = sortFlagsByPriority(activeFlags);
  
  if (sortedFlags.length === 0) {
    return null;
  }

  const flagsToShow = showAll ? sortedFlags : sortedFlags.slice(0, limit);
  const remainingCount = sortedFlags.length - limit;

  return (
    <div className="flex flex-wrap gap-1">
      {flagsToShow.map((flag) => (
        <span
          key={flag.key}
          className={`dawaa-badge customer-flag rounded-full border px-2 py-0.5 text-xs font-black ${
            compact ? "text-[10px] px-1.5 py-0" : ""
          } ${getSeverityBadgeStyle(flag.severity)}`}
        >
          {flag.label}
        </span>
      ))}
      {!showAll && remainingCount > 0 && (
        <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-600">
          +{remainingCount}
        </span>
      )}
    </div>
  );
}
