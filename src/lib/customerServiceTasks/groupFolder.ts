// فولدر تصدير الجروبات (صاحب الصيدلية 2026-11-26): البنت بتربط التطبيق مرة واحدة بالفولدر اللي بتصدّر فيه محادثات
// جروب المتابعات وجروب الطلبات، والتطبيق بيلاقي التصدير الجديد لوحده. الفولدر فيه تصديرات الأيام اللي فاتت كمان، فـ:
// - كل تصدير للجروب فيه الرسايل القديمة كلها، فبناخد أحدث ملف بس من كل جروب والأقدم منه بيتعلم إنه اتعمل معاه.
// - الملف اللي اتسجل بيتعلم في الجهاز ومابيظهرش تاني.
// - وجوه الملف، الرسايل اللي اتسجلت قبل كده بتتشال قبل المراجعة (dawaa_cs_group_known_v1).

export type GroupKind = 'followups' | 'requests';

export type GroupExport = {
  file: File;
  name: string;
  lastModified: number;
  /** This file and the older exports of the same chat: marked done together. */
  keys: string[];
  /** The kind read from the file name, when it says. */
  kind: GroupKind | null;
};

const DB_NAME = 'dawaa-cs-group-folder';
const STORE = 'handles';
const HANDLE_KEY = 'exports';
const DONE_KEY = 'dawaa.cs.groupFolder.done.v1';
const MAX_DONE = 600;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DirHandle = any;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('تعذّر فتح تخزين المتصفح'));
  });
}

async function idb<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error ?? new Error('تعذّر حفظ الفولدر'));
    });
  } finally {
    db.close();
  }
}

export function folderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window &&
    typeof indexedDB !== 'undefined'
  );
}

export async function savedFolder(): Promise<DirHandle | null> {
  if (!folderSupported()) return null;
  return (await idb<DirHandle | undefined>('readonly', (s) => s.get(HANDLE_KEY))) ?? null;
}

export async function pickFolder(): Promise<DirHandle> {
  if (!folderSupported())
    throw new Error('المتصفح ده مابيربطش فولدر. افتحي التطبيق من Chrome أو Edge على الكمبيوتر.');
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> })
    .showDirectoryPicker;
  const handle = await picker({ mode: 'read', id: 'dawaa-cs-group-exports', startIn: 'downloads' });
  await idb('readwrite', (s) => s.put(handle, HANDLE_KEY));
  return handle;
}

/** 'granted' | 'prompt' | 'denied'. With ask, the browser asks the user (needs a click). */
export async function folderPermission(handle: DirHandle, ask = false): Promise<PermissionState> {
  if (!handle) return 'denied';
  const opts = { mode: 'read' };
  const now: PermissionState =
    typeof handle.queryPermission === 'function' ? await handle.queryPermission(opts) : 'prompt';
  if (now === 'granted' || !ask || typeof handle.requestPermission !== 'function') return now;
  return handle.requestPermission(opts);
}

const fileKey = (f: { name: string; size: number; lastModified: number }) =>
  `${f.name}|${f.size}|${f.lastModified}`;

function readDone(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DONE_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function markExportsDone(keys: string[]) {
  const set = new Set(keys);
  const next = [...keys, ...readDone().filter((k) => !set.has(k))].slice(0, MAX_DONE);
  localStorage.setItem(DONE_KEY, JSON.stringify(next));
}

/** «WhatsApp Chat - جروب الطلبات (2).zip» → «whatsapp chat - جروب الطلبات»: the same chat exported again. */
export function chatBase(name: string): string {
  return name
    .replace(/\.(zip|txt)$/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s*-\s*\d{4}[-_.]\d{2}[-_.]\d{2}.*$/, '')
    .trim()
    .toLowerCase();
}

export function kindOfName(name: string): GroupKind | null {
  if (/متابع|follow/i.test(name)) return 'followups';
  if (/طلب|request|order/i.test(name)) return 'requests';
  return null;
}

/**
 * The newest export of each chat that wasn't handled yet, for this group kind
 * (files whose name says the other group are left out).
 */
export async function newExports(handle: DirHandle, kind: GroupKind): Promise<GroupExport[]> {
  const list: File[] = [];
  for await (const entry of handle.values()) {
    if (entry?.kind !== 'file' || !/\.(zip|txt)$/i.test(String(entry.name))) continue;
    list.push(await entry.getFile());
  }
  const done = new Set(readDone());
  const byChat = new Map<string, File[]>();
  for (const f of list) {
    const k = kindOfName(f.name);
    if (k && k !== kind) continue;
    const base = chatBase(f.name);
    byChat.set(base, [...(byChat.get(base) ?? []), f]);
  }
  const out: GroupExport[] = [];
  for (const group of byChat.values()) {
    group.sort((a, b) => b.lastModified - a.lastModified || b.size - a.size);
    const newest = group[0];
    if (done.has(fileKey(newest))) continue;
    out.push({
      file: newest,
      name: newest.name,
      lastModified: newest.lastModified,
      keys: group.map(fileKey),
      kind: kindOfName(newest.name),
    });
  }
  return out.sort((a, b) => b.lastModified - a.lastModified);
}
