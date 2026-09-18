import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Mic2, Video } from 'lucide-react';
import { loadWhatsAppMediaForSourceV21 } from '@/lib/whatsappMediaV21';

type MediaRow = Record<string, any>;

function MediaIcon({ kind }: { kind: string }) {
  if (kind === 'image') return <ImageIcon size={15} />;
  if (kind === 'voice') return <Mic2 size={15} />;
  if (kind === 'video') return <Video size={15} />;
  return <FileText size={15} />;
}

export default function WhatsAppMediaGalleryV21({ sourceId }: { sourceId: string }) {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadWhatsAppMediaForSourceV21(sourceId)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'تعذر تحميل الميديا'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sourceId]);

  if (loading) return <div className="text-xs text-slate-500">جاري تحميل ميديا المحادثة...</div>;
  if (error) return <div className="rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-xs text-rose-200">{error}</div>;
  if (!rows.length) return null;

  return (
    <section className="dawaa-card dawaa-card--soft p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-black text-white">ميديا المحادثة</div>
          <div className="mt-1 text-[10px] text-slate-500">الميديا الأصلية المحفوظة من Export واتساب، مرتبطة بالرسالة عند وجود دليل آمن.</div>
        </div>
        <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300">{rows.length}</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-300"><MediaIcon kind={String(row.media_kind)} /><b className="truncate">{row.original_name}</b></div>
            <div className="mt-1 text-[10px] text-slate-500">ربط بالرسالة: {row.message_id ? `${Number(row.attachment_match_confidence || 0).toFixed(0)}%` : 'غير مربوط'}</div>
            {row.media_kind === 'image' && row.signed_url ? (
              <a href={row.signed_url} target="_blank" rel="noreferrer"><img src={row.signed_url} alt={row.original_name || 'WhatsApp image'} className="mt-2 max-h-56 w-full rounded-xl object-contain bg-black/20" /></a>
            ) : null}
            {row.media_kind === 'voice' && row.signed_url ? <audio className="mt-2 w-full" controls preload="metadata" src={row.signed_url} /> : null}
            {row.media_kind === 'video' && row.signed_url ? <video className="mt-2 max-h-64 w-full rounded-xl" controls preload="metadata" src={row.signed_url} /> : null}
            {row.media_kind === 'document' && row.signed_url ? <a className="mt-2 inline-block text-xs font-black text-cyan-300 underline" href={row.signed_url} target="_blank" rel="noreferrer">فتح المستند</a> : null}
            {row.transcript_text ? <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2 text-xs leading-6 text-slate-300"><b className="text-violet-200">تفريغ الفويس:</b> {row.transcript_text}</div> : null}
            {row.extracted_text ? <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2 text-xs leading-6 text-slate-300"><b className="text-cyan-200">نص مستخرج:</b> {row.extracted_text}</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
