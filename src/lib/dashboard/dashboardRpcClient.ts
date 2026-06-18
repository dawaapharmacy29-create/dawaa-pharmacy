import { supabase } from "@/lib/supabase";
import { PerformanceCache } from "@/lib/performance/performanceOptimizations";

const cache = new PerformanceCache<any>(2 * 60 * 1000);

// invalidate cache when relevant tables change (listen for global events)
if (typeof window !== "undefined") {
  window.addEventListener("dataChanged", (ev: Event) => {
    try {
      const detail = (ev as CustomEvent).detail as { table?: string } | undefined;
      const table = detail?.table;
      if (!table) {
        cache.clear();
        return;
      }
      // simple strategy: if invoices changed, clear all dashboard aggregates
      if (["invoices", "invoice_lines", "customers", "followups", "shift_notes"].includes(table)) {
        cache.clear();
      }
    } catch (e) {
      console.warn("failed to handle dataChanged in rpc client", e);
    }
  });
}

export async function fetchDashboardAggregates(params: { start: string; end: string; branch?: string }) {
  const key = `dashboard:agg:${params.start}:${params.end}:${params.branch || 'all'}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    // Try RPC first
    const rpc = await supabase.rpc("get_dashboard_aggregates", params);
    if (!rpc.error && rpc.data) {
      cache.set(key, rpc.data);
      return rpc.data;
    }
  } catch (e) {
    console.warn("RPC fetch failed", e);
  }

  // fallback: return null to let caller use client-side aggregation
  return null;
}
