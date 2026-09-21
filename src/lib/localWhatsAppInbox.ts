const DB_NAME = 'dawaa-local-whatsapp-inbox';
const DB_VERSION = 2;
const STORE = 'directory_handles';
const HISTORY_STORE = 'analysis_history';
const HANDLE_KEY = 'whatsapp_exports';
const LEDGER_KEY = 'dawaa.whatsapp.localInbox.processed.v1';
const FAILED_KEY = 'dawaa.whatsapp.localInbox.failed.v1';
const MAX_LEDGER_ITEMS = 1000;
const MAX_FAILED_ITEMS = 200;
const FAILED_RETRY_MS = 5 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 3;

export interface LocalInboxCandidate {
  file: File;
  key: string;
  name: string;
  size: number;
  lastModified: number;
}

interface FailedInboxItem {
  key: string;
  failedAt: number;
  attempts: number;
  reason: string;
}

interface StoredHandleRow {
  id: string;
  handle: any;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const history = db.createObjectStore(HISTORY_STORE, { keyPath: 'key' });
        history.createIndex('savedAt', 'savedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('تعذر فتح مخزن إعدادات الفولدر المحلي'));
  });
}

async function putHandle(handle: any) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id: HANDLE_KEY, handle, savedAt: Date.now() } satisfies StoredHandleRow);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('تعذر حفظ اختيار الفولدر'));
      tx.onabort = () => reject(tx.error || new Error('تعذر حفظ اختيار الفولدر'));
    });
  } finally {
    db.close();
  }
}

export async function restoreLocalWhatsAppFolder(): Promise<any | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDb();
  try {
    return await new Promise<any | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(HANDLE_KEY);
      request.onsuccess = () => resolve((request.result as StoredHandleRow | undefined)?.handle || null);
      request.onerror = () => reject(request.error || new Error('تعذر استرجاع الفولدر المحلي'));
    });
  } finally {
    db.close();
  }
}

export function supportsLocalWhatsAppInbox(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window && typeof indexedDB !== 'undefined';
}

export async function connectLocalWhatsAppFolder(): Promise<any> {
  if (!supportsLocalWhatsAppInbox()) {
    throw new Error('المتصفح الحالي لا يدعم الربط المباشر بفولدر محلي. استخدم Chrome أو Edge على الكمبيوتر.');
  }
  const picker = (window as any).showDirectoryPicker as (options?: Record<string, unknown>) => Promise<any>;
  const handle = await picker({ mode: 'read', id: 'dawaa-whatsapp-exports', startIn: 'downloads' });
  const permission = await queryLocalWhatsAppFolderPermission(handle, true);
  if (permission !== 'granted') throw new Error('لم يتم منح صلاحية قراءة فولدر محادثات واتساب.');
  await putHandle(handle);
  return handle;
}

export async function queryLocalWhatsAppFolderPermission(handle: any, requestIfNeeded = false): Promise<PermissionState> {
  if (!handle) return 'denied';
  const options = { mode: 'read' };
  const current = typeof handle.queryPermission === 'function' ? await handle.queryPermission(options) : 'prompt';
  if (current === 'granted' || !requestIfNeeded || typeof handle.requestPermission !== 'function') return current;
  return handle.requestPermission(options);
}

function isSupportedExportName(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.txt') || lower.endsWith('.md');
}

function candidateKey(file: File) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function readStringLedger(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function readFailedLedger(): FailedInboxItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAILED_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is FailedInboxItem => Boolean(value && typeof value.key === 'string'))
      .map((value) => ({
        key: value.key,
        failedAt: Number(value.failedAt) || 0,
        attempts: Math.max(1, Number(value.attempts) || 1),
        reason: String(value.reason || ''),
      }));
  } catch {
    return [];
  }
}

export function markLocalWhatsAppFileProcessed(key: string) {
  const next = [key, ...readStringLedger(LEDGER_KEY).filter((item) => item !== key)].slice(0, MAX_LEDGER_ITEMS);
  localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
  const failed = readFailedLedger().filter((item) => item.key !== key);
  localStorage.setItem(FAILED_KEY, JSON.stringify(failed));
}

export function markLocalWhatsAppFileFailed(key: string, reason: string) {
  const previous = readFailedLedger();
  const existing = previous.find((item) => item.key === key);
  const nextItem: FailedInboxItem = {
    key,
    failedAt: Date.now(),
    attempts: Math.min(MAX_FAILED_ATTEMPTS, (existing?.attempts || 0) + 1),
    reason: String(reason || 'تعذر معالجة الملف').slice(0, 500),
  };
  const next = [nextItem, ...previous.filter((item) => item.key !== key)].slice(0, MAX_FAILED_ITEMS);
  localStorage.setItem(FAILED_KEY, JSON.stringify(next));
}

export function resetLocalWhatsAppProcessedLedger() {
  localStorage.removeItem(LEDGER_KEY);
  localStorage.removeItem(FAILED_KEY);
}

export async function getUnprocessedWhatsAppExports(handle: any, limit = 10): Promise<LocalInboxCandidate[]> {
  const permission = await queryLocalWhatsAppFolderPermission(handle, false);
  if (permission !== 'granted') return [];
  const processed = new Set(readStringLedger(LEDGER_KEY));
  const failed = new Map(readFailedLedger().map((item) => [item.key, item]));
  const now = Date.now();
  const candidates: LocalInboxCandidate[] = [];
  for await (const entry of handle.values()) {
    if (!entry || entry.kind !== 'file' || !isSupportedExportName(String(entry.name || ''))) continue;
    const file = await entry.getFile();
    const key = candidateKey(file);
    if (processed.has(key)) continue;
    const failedItem = failed.get(key);
    if (failedItem) {
      if (failedItem.attempts >= MAX_FAILED_ATTEMPTS) continue;
      if (now - failedItem.failedAt < FAILED_RETRY_MS) continue;
    }
    candidates.push({ file, key, name: file.name, size: file.size, lastModified: file.lastModified });
  }
  candidates.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name));
  return candidates.slice(0, Math.max(1, Math.min(25, limit)));
}

export async function getNewestUnprocessedWhatsAppExport(handle: any): Promise<LocalInboxCandidate | null> {
  const candidates = await getUnprocessedWhatsAppExports(handle, 25);
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => b.lastModified - a.lastModified || b.size - a.size || a.name.localeCompare(b.name))[0] || null;
}


export interface LocalWhatsAppAnalysisHistoryRow<T = unknown> {
  key: string;
  fileName: string;
  savedAt: number;
  payload: T;
}

export async function saveLocalWhatsAppAnalysisHistory<T>(
  key: string,
  fileName: string,
  payload: T
) {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE, 'readwrite');
      tx.objectStore(HISTORY_STORE).put({
        key,
        fileName,
        savedAt: Date.now(),
        payload,
      } satisfies LocalWhatsAppAnalysisHistoryRow<T>);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('تعذر حفظ سجل تحليل واتساب المحلي'));
      tx.onabort = () => reject(tx.error || new Error('تعذر حفظ سجل تحليل واتساب المحلي'));
    });
  } finally {
    db.close();
  }
}

export async function loadLocalWhatsAppAnalysisHistory<T>(limit = 30): Promise<LocalWhatsAppAnalysisHistoryRow<T>[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE, 'readonly');
      const store = tx.objectStore(HISTORY_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = (request.result || []) as LocalWhatsAppAnalysisHistoryRow<T>[];
        resolve(
          rows
            .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0))
            .slice(0, Math.max(1, Math.min(100, limit)))
        );
      };
      request.onerror = () => reject(request.error || new Error('تعذر استرجاع سجل تحليل واتساب المحلي'));
    });
  } finally {
    db.close();
  }
}

export async function clearLocalWhatsAppAnalysisHistory() {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE, 'readwrite');
      tx.objectStore(HISTORY_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('تعذر مسح سجل التحليل المحلي'));
      tx.onabort = () => reject(tx.error || new Error('تعذر مسح سجل التحليل المحلي'));
    });
  } finally {
    db.close();
  }
}
