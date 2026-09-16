import { useMemo } from 'react';
import { FileText, Image, Mic, Video } from 'lucide-react';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';

type RoleMessage = {
  messageId?: string;
  role?: string;
  staffName?: string | null;
  confidence?: number;
};

function kindLabel(kind: string) {
  if (kind === 'image') return 'صورة';
  if (kind === 'voice') return 'رسالة صوتية';
  if (kind === 'video') return 'فيديو';
  if (kind === 'document') return 'مستند';
  if (kind === 'deleted') return 'رسالة محذوفة';
  return null;
}

function roleLabel(role?: string) {
  if (role === 'customer') return 'العميل';
  if (role === 'pharmacist') return 'الدكتور / الصيدلي';
  if (role === 'customer_service') return 'خدمة العملاء';
  if (role === 'delivery') return 'الدليفري';
  if (role === 'management') return 'الإدارة';
  if (role === 'system') return 'النظام';
  return 'الصيدلية — الدور غير محسوم';
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'image') return <Image size={14} />;
  if (kind === 'voice') return <Mic size={14} />;
  if (kind === 'video') return <Video size={14} />;
  return <FileText size={14} />;
}

function formatTime(value: Date) {
  return value.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

export default function WhatsAppStructuredTranscriptV15({
  rawText,
  participantRoles,
}: {
  rawText: string | null | undefined;
  participantRoles?: { messages?: RoleMessage[] } | null;
}) {
  const messages = useMemo(() => {
    if (!rawText?.trim()) return [];
    try { return parseWhatsAppExport(rawText); } catch { return []; }
  }, [rawText]);
  const rolesByMessage = useMemo(
    () => new Map((participantRoles?.messages || []).map((row) => [String(row.messageId || ''), row])),
    [participantRoles],
  );

  if (!rawText?.trim()) return <div className="p-6 text-center text-sm text-slate-500">لا يوجد نص محفوظ.</div>;
  if (!messages.length) {
    return <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs leading-6 text-slate-300">{rawText}</pre>;
  }

  return (
    <div className="max-h-[650px] space-y-2 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/45 p-3">
      {messages.map((message) => {
        const outbound = message.direction === 'outbound';
        const system = message.direction === 'system';
        if (system) {
          return <div key={message.id} className="mx-auto max-w-2xl rounded-lg bg-slate-900/70 px-3 py-2 text-center text-[10px] text-slate-500">{message.text}</div>;
        }
        const media = kindLabel(message.kind);
        const roleInfo = rolesByMessage.get(message.id);
        const senderRole = !outbound ? 'العميل' : roleLabel(roleInfo?.role);
        const senderName = outbound ? (roleInfo?.staffName || message.sender) : message.sender;
        return (
          <div key={message.id} data-message-id={message.id} className={`flex ${outbound ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[88%] rounded-2xl border px-3 py-2 ${outbound ? 'border-emerald-400/20 bg-emerald-500/10' : 'border-cyan-400/20 bg-cyan-500/10'}`}>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span className={`font-black ${outbound ? 'text-emerald-200' : 'text-cyan-200'}`}>{senderRole} • {senderName}</span>
                <span className="text-slate-500">{formatTime(message.timestamp)}</span>
                {outbound && roleInfo?.confidence ? <span className="text-slate-500">ثقة الدور {Math.round(Number(roleInfo.confidence))}%</span> : null}
                {message.forwarded ? <span className="text-amber-300">معاد توجيهها</span> : null}
              </div>
              {message.replyTo ? (
                <div className="mt-2 rounded-lg border-r-2 border-violet-400 bg-slate-950/35 px-2 py-1.5 text-[10px] leading-5 text-slate-400">
                  {message.replyTo.sender ? <b className="text-violet-200">رد على {message.replyTo.sender}: </b> : null}{message.replyTo.text}
                </div>
              ) : null}
              {media ? (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/45 px-2 py-2 text-xs text-slate-300">
                  <KindIcon kind={message.kind} />
                  <span>{media}</span>
                  {message.mediaAvailable === false ? <span className="text-amber-300">• ملف الميديا غير مرتبط بالعرض بعد</span> : null}
                </div>
              ) : null}
              {message.text?.trim() ? <div className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-200">{message.text}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
