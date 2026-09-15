const DB_NAME = 'dawaa-local-whatsapp-inbox';
const DB_VERSION = 1;
const STORE = 'directory_handles';
const HANDLE_KEY = 'whatsapp_exports';
const LEDGER_KEY = 'dawaa.whatsapp.localInbox.processed.v1';
const MAX_LEDGER_ITEMS = 500;

export interface LocalInboxCandidate {
  file: File;
  key: string;
  name: string;
  size: number;
  lastModified: number;
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

function readLedger(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export function markLocalWhatsAppFileProcessed(key: string) {
  const next = [key, ...readLedger().filter((item) => item !== key)].slice(0, MAX_LEDGER_ITEMS);
  localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
}

export function resetLocalWhatsAppProcessedLedger() {
  localStorage.removeItem(LEDGER_KEY);
}

export async function getNewestUnprocessedWhatsAppExport(handle: any): Promise<LocalInboxCandidate | null> {
  const permission = await queryLocalWhatsAppFolderPermission(handle, false);
  if (permission !== 'granted') return null;
  const processed = new Set(readLedger());
  const candidates: LocalInboxCandidate[] = [];
  for await (const entry of handle.values()) {
    if (!entry || entry.kind !== 'file' || !isSupportedExportName(String(entry.name || ''))) continue;
    const file = await entry.getFile();
    const key = candidateKey(file);
    if (processed.has(key)) continue;
    candidates.push({ file, key, name: file.name, size: file.size, lastModified: file.lastModified });
  }
  candidates.sort((a, b) => b.lastModified - a.lastModified || b.size - a.size || a.name.localeCompare(b.name));
  return candidates[0] || null;
}
