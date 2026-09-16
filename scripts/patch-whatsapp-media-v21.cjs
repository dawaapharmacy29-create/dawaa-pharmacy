const fs = require('fs');
const path = require('path');

function patchFile(filePath, patches, tag = 'whatsapp-media-v21') {
  const file = path.join(process.cwd(), filePath);
  let src = fs.readFileSync(file, 'utf8');
  for (const { label, from, to } of patches) {
    if (src.includes(to)) { console.log(`[${tag}] ${label}: already applied`); continue; }
    if (!src.includes(from)) throw new Error(`[${tag}] ${label}: anchor not found in ${filePath}`);
    src = src.replace(from, to);
    console.log(`[${tag}] ${label}: applied`);
  }
  fs.writeFileSync(file, src);
}

patchFile('src/pages/WhatsAppConversationAnalyzer.tsx', [
  {
    label: 'media imports',
    from: `import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';`,
    to: `import { readWhatsAppExportFile, type WhatsAppExportMediaFile } from '@/lib/whatsappExportFileReader';\nimport { attachWhatsAppMediaToMessagesV21, syncWhatsAppMediaForSourceV21 } from '@/lib/whatsappMediaV21';`,
  },
  {
    label: 'media state',
    from: `  const [loading, setLoading] = useState(false);`,
    to: `  const [loading, setLoading] = useState(false);\n  const [mediaFiles, setMediaFiles] = useState<WhatsAppExportMediaFile[]>([]);\n  const [mediaLinkSummary, setMediaLinkSummary] = useState<{ totalFiles: number; exactMatches: number; orderedMatches: number; unmatchedFiles: number; unmatchedMessages: number } | null>(null);`,
  },
  {
    label: 'attach media before session split',
    from: `      const messages = parseWhatsAppExport(source.text);\n      if (!messages.length) throw new Error('لم يتم التعرف على أي رسائل WhatsApp داخل الملف.');\n      const parsedSessions = splitWhatsAppSessions(messages, 120);`,
    to: `      const parsedMessages = parseWhatsAppExport(source.text);\n      if (!parsedMessages.length) throw new Error('لم يتم التعرف على أي رسائل WhatsApp داخل الملف.');\n      const attachedMedia = attachWhatsAppMediaToMessagesV21(parsedMessages, source.mediaFiles || []);\n      const messages = attachedMedia.messages;\n      setMediaFiles(source.mediaFiles || []);\n      setMediaLinkSummary(attachedMedia.summary);\n      const parsedSessions = splitWhatsAppSessions(messages, 120);`,
  },
  {
    label: 'reset media on read failure',
    from: `      setSessions([]);\n      setSelectedId('');\n      toast.error(error instanceof Error ? error.message : 'تعذر قراءة ملف المحادثة');`,
    to: `      setSessions([]);\n      setSelectedId('');\n      setMediaFiles([]);\n      setMediaLinkSummary(null);\n      toast.error(error instanceof Error ? error.message : 'تعذر قراءة ملف المحادثة');`,
  },
  {
    label: 'show import media coverage',
    from: `            <FileArchive size={15} />{fileName}\n          </div>`,
    to: `            <FileArchive size={15} />{fileName}\n            {mediaLinkSummary ? <span className="mr-auto text-[10px] text-slate-400">ميديا داخل ZIP: {mediaLinkSummary.totalFiles} • ربط دقيق: {mediaLinkSummary.exactMatches} • ربط ترتيبي: {mediaLinkSummary.orderedMatches} • غير مربوط: {mediaLinkSummary.unmatchedFiles}</span> : null}\n          </div>`,
  },
  {
    label: 'inline media preview',
    from: `                          <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-100">{message.text || '—'}</div>`,
    to: `                          <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-100">{message.text || '—'}</div>\n                          {message.mediaObjectUrl && message.kind === 'image' ? <img src={message.mediaObjectUrl} alt={message.mediaFileName || 'مرفق واتساب'} className="mt-2 max-h-80 w-full rounded-xl object-contain bg-black/20" /> : null}\n                          {message.mediaObjectUrl && message.kind === 'voice' ? <audio controls preload="metadata" className="mt-2 w-full" src={message.mediaObjectUrl} /> : null}\n                          {message.mediaObjectUrl && message.kind === 'video' ? <video controls preload="metadata" className="mt-2 max-h-80 w-full rounded-xl" src={message.mediaObjectUrl} /> : null}\n                          {message.mediaObjectUrl && message.kind === 'document' ? <a href={message.mediaObjectUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-black text-cyan-300 underline">فتح {message.mediaFileName || 'المستند'}</a> : null}\n                          {message.mediaAvailable ? <div className="mt-1 text-[10px] text-emerald-300">الميديا الأصلية متاحة • ثقة الربط {Number(message.mediaMatchConfidence || 0).toFixed(0)}%</div> : null}`,
  },
]);

// This anchor exists only after V15 queue persistence is applied. Keeping media persistence at the end
// means the UI can preview locally first, then persist only when a source row actually exists.
const analyzerFile = path.join(process.cwd(), 'src/pages/WhatsAppConversationAnalyzer.tsx');
let analyzer = fs.readFileSync(analyzerFile, 'utf8');
const persistAnchor = `          persistedSessionSources.push({ sessionId: item.session.id, sourceId: persisted.id, contextOnly });`;
const persistReplacement = `${persistAnchor}\n          if (mediaFiles.length) {\n            try {\n              await syncWhatsAppMediaForSourceV21(persisted.id, item.session, mediaFiles, String(user?.name || user?.username || user?.id || ''));\n            } catch (mediaPersistError) {\n              console.warn('[whatsapp-media-v21] media sync failed; source remains preserved', persisted.id, mediaPersistError);\n            }\n          }`;
if (!analyzer.includes('syncWhatsAppMediaForSourceV21(persisted.id')) {
  if (!analyzer.includes(persistAnchor)) throw new Error('[whatsapp-media-v21] persistence anchor not found after V15');
  analyzer = analyzer.replace(persistAnchor, persistReplacement);
  fs.writeFileSync(analyzerFile, analyzer);
  console.log('[whatsapp-media-v21] persist linked media after source: applied');
} else console.log('[whatsapp-media-v21] persist linked media after source: already applied');

patchFile('src/pages/WhatsAppReviewQueueV4.tsx', [
  {
    label: 'queue media gallery import',
    from: `import WhatsAppStructuredTranscriptV15 from '@/components/reviews/WhatsAppStructuredTranscriptV15';`,
    to: `import WhatsAppStructuredTranscriptV15 from '@/components/reviews/WhatsAppStructuredTranscriptV15';\nimport WhatsAppMediaGalleryV21 from '@/components/reviews/WhatsAppMediaGalleryV21';`,
  },
  {
    label: 'queue media gallery render',
    from: `            <section className="dawaa-card dawaa-card--soft p-4"><div className="flex items-center gap-2 font-black text-white"><FileText size={17}/>المحادثة الأصلية المنظمة</div>`,
    to: `            <WhatsAppMediaGalleryV21 sourceId={selected.id} />\n\n            <section className="dawaa-card dawaa-card--soft p-4"><div className="flex items-center gap-2 font-black text-white"><FileText size={17}/>المحادثة الأصلية المنظمة</div>`,
  },
]);

console.log('[whatsapp-media-v21] real ZIP media reader, local preview, private persistence and queue gallery wired successfully');
