import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  folderPermission,
  folderSupported,
  newExports,
  pickFolder,
  savedFolder,
  type GroupExport,
  type GroupKind,
} from '@/lib/customerServiceTasks/groupFolder';

const timeLabel = (ms: number) =>
  new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));

/**
 * The linked exports folder: shows the new export of this group (newest per chat, not handled yet) and opens it
 * in the same review as a picked file. `version` changes after a save so the list scans again.
 */
export default function GroupFolder({
  kind,
  busy,
  version,
  onOpen,
}: {
  kind: GroupKind;
  busy: boolean;
  version: number;
  onOpen: (e: GroupExport) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [handle, setHandle] = useState<any>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [files, setFiles] = useState<GroupExport[] | null>(null);
  const [scanning, setScanning] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scan = useCallback(
    async (h: any) => {
      setScanning(true);
      try {
        setFiles(await newExports(h, kind));
      } catch {
        setFiles(null);
        setPermission(await folderPermission(h).catch(() => 'denied' as PermissionState));
      } finally {
        setScanning(false);
      }
    },
    [kind]
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      const h = await savedFolder().catch(() => null);
      if (!live || !h) return;
      setHandle(h);
      const p = await folderPermission(h).catch(() => 'denied' as PermissionState);
      if (!live) return;
      setPermission(p);
      if (p === 'granted') void scan(h);
    })();
    return () => {
      live = false;
    };
  }, [scan, version]);

  // لما البنت ترجع للتطبيق بعد ما تصدّر، بنبص في الفولدر تاني.
  useEffect(() => {
    if (!handle || permission !== 'granted') return;
    const onFocus = () => void scan(handle);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [handle, permission, scan]);

  if (!folderSupported()) return null;

  async function connect() {
    try {
      const h = await pickFolder();
      setHandle(h);
      const p = await folderPermission(h, true);
      setPermission(p);
      if (p === 'granted') await scan(h);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function allow() {
    const p = await folderPermission(handle, true).catch(() => 'denied' as PermissionState);
    setPermission(p);
    if (p === 'granted') await scan(handle);
  }

  if (!handle)
    return (
      <button
        className="btn-secondary inline-flex items-center gap-1"
        onClick={() => void connect()}
      >
        <FolderOpen size={16} /> اربطي فولدر التصدير
      </button>
    );

  if (permission !== 'granted')
    return (
      <button className="btn-secondary inline-flex items-center gap-1" onClick={() => void allow()}>
        <FolderOpen size={16} /> افتحي فولدر «{handle.name}»
      </button>
    );

  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-[var(--dawaa-theme-border)] px-2 py-1 text-xs">
      <span className="inline-flex items-center gap-1 font-bold">
        <FolderOpen size={14} /> {handle.name}
      </span>
      {scanning ? (
        <Loader2 size={14} className="animate-spin" />
      ) : !files?.length ? (
        <span className="opacity-60">مفيش تصدير جديد</span>
      ) : (
        files.map((f) => (
          <button
            key={f.keys[0]}
            className="btn-primary !px-2 !py-1 text-xs"
            disabled={busy}
            title={f.name}
            onClick={() => onOpen(f)}
          >
            جديد: {f.name.replace(/\.(zip|txt)$/i, '').replace(/^WhatsApp Chat( with| -)?\s*/i, '')}{' '}
            · {timeLabel(f.lastModified)}
          </button>
        ))
      )}
      <button
        className="opacity-60 hover:opacity-100"
        title="دوّري تاني"
        disabled={scanning}
        onClick={() => void scan(handle)}
      >
        <RefreshCw size={14} />
      </button>
      <button className="underline opacity-60 hover:opacity-100" onClick={() => void connect()}>
        غيّري الفولدر
      </button>
    </div>
  );
}
