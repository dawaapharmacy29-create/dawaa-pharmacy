import { supabase } from '@/lib/supabase';
import type { WarehouseShortageSnapshot } from '@/lib/api/customerRequestWarehouseExport';

export type WarehouseDispatch = {
  id: string;
  dispatch_no: number;
  branch: string;
  sent_at: string;
  total_products: number;
  total_requests: number;
  total_quantity: number;
  urgent_requests: number;
  unlinked_products: number;
  notes?: string | null;
};

export type WarehouseGroupCycleMetric = {
  dispatchCount: number;
  lastSentAt: string | null;
  lastSentQuantity: number;
  newRequestCount: number;
  quantityDelta: number;
  ageDays: number;
  repeated: boolean;
  stale: boolean;
  state: 'never_sent' | 'new_since_last' | 'quantity_increased' | 'repeated_unchanged' | 'improving';
};

export type WarehouseDispatchContext = {
  featureReady: boolean;
  latestDispatch: WarehouseDispatch | null;
  dispatches: WarehouseDispatch[];
  metricsByKey: Record<string, WarehouseGroupCycleMetric>;
  neverSentGroups: number;
  newSinceLastGroups: number;
  repeatedGroups: number;
  staleGroups: number;
  resolvedSinceLastGroups: number;
  latestResponseRate: number;
};

type DispatchItem = {
  dispatch_id: string;
  product_key: string;
  total_quantity: number | string;
  request_ids: unknown;
  created_at?: string;
};

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function ageDays(value: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function isMissingRelation(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === '42P01' || /warehouse_shortage_dispatch/i.test(error?.message || '');
}

export async function getWarehouseDispatchContext(snapshot: WarehouseShortageSnapshot): Promise<WarehouseDispatchContext> {
  const branchKey = snapshot.branch && snapshot.branch !== '' ? snapshot.branch : 'all';
  const dispatchQuery = supabase
    .from('warehouse_shortage_dispatches')
    .select('id,dispatch_no,branch,sent_at,total_products,total_requests,total_quantity,urgent_requests,unlinked_products,notes')
    .eq('branch', branchKey)
    .order('sent_at', { ascending: false })
    .limit(12);

  const { data: dispatchData, error: dispatchError } = await dispatchQuery;
  if (dispatchError) {
    if (isMissingRelation(dispatchError)) {
      return {
        featureReady: false,
        latestDispatch: null,
        dispatches: [],
        metricsByKey: {},
        neverSentGroups: snapshot.groups.length,
        newSinceLastGroups: snapshot.groups.length,
        repeatedGroups: 0,
        staleGroups: 0,
        resolvedSinceLastGroups: 0,
        latestResponseRate: 0,
      };
    }
    throw new Error(dispatchError.message);
  }

  const dispatches = ((dispatchData || []) as WarehouseDispatch[]).map((row) => ({
    ...row,
    dispatch_no: Number(row.dispatch_no || 0),
    total_products: Number(row.total_products || 0),
    total_requests: Number(row.total_requests || 0),
    total_quantity: Number(row.total_quantity || 0),
    urgent_requests: Number(row.urgent_requests || 0),
    unlinked_products: Number(row.unlinked_products || 0),
  }));

  if (!dispatches.length) {
    const metricsByKey = Object.fromEntries(snapshot.groups.map((group) => [group.key, {
      dispatchCount: 0,
      lastSentAt: null,
      lastSentQuantity: 0,
      newRequestCount: group.requestCount,
      quantityDelta: group.totalQuantity,
      ageDays: ageDays(group.oldestRequestAt),
      repeated: false,
      stale: false,
      state: 'never_sent' as const,
    }]));
    return {
      featureReady: true,
      latestDispatch: null,
      dispatches: [],
      metricsByKey,
      neverSentGroups: snapshot.groups.length,
      newSinceLastGroups: snapshot.groups.length,
      repeatedGroups: 0,
      staleGroups: 0,
      resolvedSinceLastGroups: 0,
      latestResponseRate: 0,
    };
  }

  const ids = dispatches.map((dispatch) => dispatch.id);
  const { data: itemData, error: itemError } = await supabase
    .from('warehouse_shortage_dispatch_items')
    .select('dispatch_id,product_key,total_quantity,request_ids,created_at')
    .in('dispatch_id', ids)
    .limit(10000);
  if (itemError) throw new Error(itemError.message);

  const items = (itemData || []) as DispatchItem[];
  const dispatchOrder = new Map(dispatches.map((dispatch, index) => [dispatch.id, index]));
  const itemsByKey = new Map<string, DispatchItem[]>();
  for (const item of items) {
    const list = itemsByKey.get(item.product_key) || [];
    list.push(item);
    itemsByKey.set(item.product_key, list);
  }
  for (const list of itemsByKey.values()) {
    list.sort((a, b) => (dispatchOrder.get(a.dispatch_id) ?? 999) - (dispatchOrder.get(b.dispatch_id) ?? 999));
  }

  const dispatchById = new Map(dispatches.map((dispatch) => [dispatch.id, dispatch]));
  const metricsByKey: Record<string, WarehouseGroupCycleMetric> = {};
  let neverSentGroups = 0;
  let newSinceLastGroups = 0;
  let repeatedGroups = 0;
  let staleGroups = 0;

  for (const group of snapshot.groups) {
    const history = itemsByKey.get(group.key) || [];
    const latestItem = history[0];
    const previousIds = new Set(parseIds(latestItem?.request_ids));
    const newRequestCount = latestItem ? group.requestIds.filter((id) => !previousIds.has(id)).length : group.requestCount;
    const lastSentQuantity = Number(latestItem?.total_quantity || 0);
    const quantityDelta = group.totalQuantity - lastSentQuantity;
    const dispatchCount = new Set(history.map((item) => item.dispatch_id)).size;
    const lastSentAt = latestItem ? dispatchById.get(latestItem.dispatch_id)?.sent_at || null : null;
    const days = ageDays(group.oldestRequestAt);
    const repeated = dispatchCount >= 2;
    const stale = repeated && days >= 3;
    const state: WarehouseGroupCycleMetric['state'] = !latestItem
      ? 'never_sent'
      : newRequestCount > 0
        ? 'new_since_last'
        : quantityDelta > 0
          ? 'quantity_increased'
          : quantityDelta < 0
            ? 'improving'
            : 'repeated_unchanged';

    if (!latestItem) neverSentGroups += 1;
    if (!latestItem || newRequestCount > 0) newSinceLastGroups += 1;
    if (repeated) repeatedGroups += 1;
    if (stale) staleGroups += 1;

    metricsByKey[group.key] = {
      dispatchCount,
      lastSentAt,
      lastSentQuantity,
      newRequestCount,
      quantityDelta,
      ageDays: days,
      repeated,
      stale,
      state,
    };
  }

  const latestDispatch = dispatches[0] || null;
  const currentKeys = new Set(snapshot.groups.map((group) => group.key));
  const latestItems = latestDispatch ? items.filter((item) => item.dispatch_id === latestDispatch.id) : [];
  const latestUniqueKeys = new Set(latestItems.map((item) => item.product_key));
  const resolvedSinceLastGroups = [...latestUniqueKeys].filter((key) => !currentKeys.has(key)).length;
  const latestResponseRate = latestUniqueKeys.size
    ? Math.round((resolvedSinceLastGroups / latestUniqueKeys.size) * 1000) / 10
    : 0;

  return {
    featureReady: true,
    latestDispatch,
    dispatches,
    metricsByKey,
    neverSentGroups,
    newSinceLastGroups,
    repeatedGroups,
    staleGroups,
    resolvedSinceLastGroups,
    latestResponseRate,
  };
}

export async function recordWarehouseShortageDispatch(snapshot: WarehouseShortageSnapshot, notes = '', createdByLabel = '') {
  const items = snapshot.groups.map((group) => ({
    product_id: group.productId,
    product_key: group.key,
    product_code: group.productCode || null,
    product_name: group.canonicalName,
    total_quantity: group.totalQuantity,
    request_count: group.requestCount,
    customer_count: group.customerCount,
    urgent_count: group.urgentCount,
    branch_breakdown: group.branches,
    request_ids: group.requestIds,
    request_names: group.requestNames,
    link_quality: group.linkQuality,
    oldest_request_at: group.oldestRequestAt,
    latest_request_at: group.latestRequestAt,
  }));

  const { data, error } = await supabase.rpc('record_warehouse_shortage_dispatch', {
    p_branch: snapshot.branch || 'all',
    p_summary: {
      generated_at: snapshot.generatedAt,
      total_products: snapshot.groups.length,
      total_requests: snapshot.totalRequests,
      total_quantity: snapshot.totalQuantity,
      urgent_requests: snapshot.urgentRequests,
      unlinked_products: snapshot.unlinkedGroups,
    },
    p_items: items,
    p_notes: notes || null,
    p_created_by_label: createdByLabel || null,
  });
  if (error) {
    if (isMissingRelation(error)) throw new Error('سجل دورات المخازن لم يتم تطبيقه على قاعدة البيانات بعد.');
    throw new Error(error.message);
  }
  return data as { id?: string; dispatch_no?: number; sent_at?: string; items?: number } | null;
}
