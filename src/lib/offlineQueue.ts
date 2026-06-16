import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type OfflineQueueActionType =
  | "customer_followup"
  | "customer_notes"
  | "customer_flags"
  | "shift_note"
  | "activity_log"
  | "generic";

export type OfflineQueueItem = {
  id: string;
  type: OfflineQueueActionType;
  table?: string;
  method?: "insert" | "update" | "upsert" | "rpc";
  payload: Record<string, unknown>;
  match?: Record<string, unknown>;
  rpcName?: string;
  createdAt: string;
  updatedAt?: string;
  attempts: number;
  lastError?: string | null;
  status: "pending" | "syncing" | "failed";
};

const STORAGE_KEY = "dawaa_offline_queue_v1";
const MAX_ATTEMPTS = 5;

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getOfflineQueue(): OfflineQueueItem[] {
  if (typeof window === "undefined") return [];
  return safeJsonParse<OfflineQueueItem[]>(window.localStorage.getItem(STORAGE_KEY), []);
}

function saveOfflineQueue(items: OfflineQueueItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("dawaa-offline-queue-changed", { detail: items.length }));
}

export function addOfflineQueueItem(input: Omit<OfflineQueueItem, "id" | "createdAt" | "attempts" | "status">) {
  const item: OfflineQueueItem = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
  const items = getOfflineQueue();
  items.push(item);
  saveOfflineQueue(items);
  return item;
}

export function getOfflineQueueCount() {
  return getOfflineQueue().filter((item) => item.status !== "syncing").length;
}

async function runItem(item: OfflineQueueItem) {
  if (!isSupabaseConfigured) throw new Error("Supabase غير مُعد.");
  if (item.method === "rpc") {
    if (!item.rpcName) throw new Error("RPC name missing");
    const { error } = await supabase.rpc(item.rpcName, item.payload as any);
    if (error) throw error;
    return;
  }

  if (!item.table) throw new Error("table missing");
  if (item.method === "update") {
    let query = supabase.from(item.table).update(item.payload);
    for (const [key, value] of Object.entries(item.match || {})) query = query.eq(key, value as any);
    const { error } = await query;
    if (error) throw error;
    return;
  }

  if (item.method === "upsert") {
    const { error } = await supabase.from(item.table).upsert(item.payload);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from(item.table).insert(item.payload);
  if (error) throw error;
}

export async function syncOfflineQueue() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { synced: 0, failed: 0, remaining: getOfflineQueueCount() };
  const items = getOfflineQueue();
  let synced = 0;
  let failed = 0;
  const remaining: OfflineQueueItem[] = [];

  for (const item of items) {
    if (item.attempts >= MAX_ATTEMPTS) {
      remaining.push({ ...item, status: "failed" });
      continue;
    }

    try {
      await runItem({ ...item, status: "syncing" });
      synced += 1;
    } catch (error) {
      failed += 1;
      remaining.push({
        ...item,
        status: "failed",
        attempts: item.attempts + 1,
        updatedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  saveOfflineQueue(remaining);
  return { synced, failed, remaining: remaining.length };
}

export function initOfflineQueueAutoSync() {
  if (typeof window === "undefined") return;
  const onOnline = () => {
    syncOfflineQueue().catch((error) => console.warn("[OfflineQueue] sync failed", error));
  };
  window.addEventListener("online", onOnline);
  setTimeout(onOnline, 1500);
}
