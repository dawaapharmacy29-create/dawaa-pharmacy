import type { WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { Building2, CheckCheck, FileText, Forward, Hash, Image as ImageIcon, Mic, Phone, UserRound, Video } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

interface Props {
  messages: WhatsAppParsedMessage[];
  customerName: string | null;
  customerCode: string | null;
  customerPhone: string | null;
  branch: string | null;
  caseStartedAt: string | null;
  caseEndedAt: string | null;
}

function inCaseWindow(message: WhatsAppParsedMessage, start: string | null, end: string | null): boolean {
  const ts = new Date(message.timestamp).getTime();
  const from = start ? new Date(start).getTime() : Number.NEGATIVE_INFINITY;
  const to = end ? new Date(end).getTime() : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(ts)) return true;
  return ts >= from && ts <= to;
}

function MediaPlaceholder({ message }: { message: WhatsAppParsedMessage }) {
  if (!message.mediaPlaceholder && !['image', 'voice', 'video', 'document'].includes(message.kind)) return null;
  const label =
    message.kind === 'image' ? 'صورة' :
    message.kind === 'voice' ? 'رسالة صوتية' :
    message.kind === 'video' ? 'فيديو' : 'ملف';
  const Icon =
    message.kind === 'image' ? ImageIcon :
    message.kind === 'voice' ? Mic :
    message.kind === 'video' ? Video : FileText;
  return (
    <div className="mb-2 flex min-w-[180px] items-center gap-3 rounded-xl border border-black/10 bg-black/5 p-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/10"><Icon size={18} /></span>
      <div>
        <div className="font-bold">{label}</div>
        <div className="text-[10px] opacity-70">
          {message.mediaAvailable === false ? 'الملف غير متاح في المصدر' : message.mediaFileName || 'مرفق من المحادثة'}
        </div>
      </div>
    </div>
  );
}

export function WhatsAppConversationPanel({
  messages,
  customerName,
  customerCode,
  customerPhone,
  branch,
  caseStartedAt,
  caseEndedAt,
}: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--dawaa-theme-border)] bg-[#0b141a] shadow-sm" dir="rtl">
      <div className="border-b border-white/10 bg-[#202c33] px-4 py-3 text-white">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white">
            <UserRound size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black">{customerName || 'عميل غير مسمى'}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/70">
              <span className="inline-flex items-center gap-1"><Hash size={11} /> {customerCode || 'كود غير متاح'}</span>
              <span className="inline-flex items-center gap-1"><Phone size={11} /> {customerPhone || 'رقم غير متاح'}</span>
              <span className="inline-flex items-center gap-1"><Building2 size={11} /> {branch || 'فرع غير محدد'}</span>
            </div>
          </div>
          <div className="rounded-xl bg-white/5 px-3 py-2 text-left text-[10px] text-white/70">
            <div>الحالة الحالية</div>
            <div className="mt-1 text-white">{caseStartedAt ? formatDateTime(caseStartedAt) : '—'}</div>
            <div>{caseEndedAt ? formatDateTime(caseEndedAt) : 'مستمرة'}</div>
          </div>
        </div>
      </div>

      <div
        className="max-h-[680px] space-y-1.5 overflow-y-auto px-3 py-4 sm:px-6"
        style={{
          backgroundColor: '#0b141a',
          backgroundImage: 'radial-gradient(rgba(255,255,255,.025) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      >
        <div className="mx-auto mb-4 w-fit rounded-lg bg-[#182229] px-3 py-1.5 text-[10px] text-white/65">
          الرسائل الباهتة خارج حدود الحالة الحالية، لكنها معروضة للحفاظ على سياق المحادثة كاملًا.
        </div>

        {messages.length ? messages.map((message) => {
          const inside = inCaseWindow(message, caseStartedAt, caseEndedAt);
          if (message.direction === 'system') {
            return (
              <div key={message.id} className={inside ? 'py-1 text-center' : 'py-1 text-center opacity-35'}>
                <span className="inline-block max-w-[86%] rounded-lg bg-[#182229] px-3 py-1.5 text-[10px] leading-5 text-white/65">
                  {message.text || `[${message.kind}]`}
                </span>
              </div>
            );
          }

          const outbound = message.direction === 'outbound';
          return (
            <div key={message.id} className={`flex ${outbound ? 'justify-start' : 'justify-end'} ${inside ? '' : 'opacity-35'}`}>
              <div
                className={`relative max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-6 shadow-sm sm:max-w-[72%] ${
                  outbound ? 'rounded-tr-md bg-[#005c4b] text-white' : 'rounded-tl-md bg-[#202c33] text-white'
                }`}
              >
                <div className="mb-1 flex items-center gap-2 text-[10px] font-bold text-white/65">
                  <span>{outbound ? (message.sender || 'صيدليات دواء') : (customerName || message.sender || 'العميل')}</span>
                  {message.forwarded ? <span className="inline-flex items-center gap-1 font-normal"><Forward size={10} /> مُعاد توجيهها</span> : null}
                  {inside ? <span className="rounded-full bg-white/10 px-1.5 py-0.5 font-normal">داخل الحالة</span> : null}
                </div>
                <MediaPlaceholder message={message} />
                {message.text ? <div className="whitespace-pre-wrap break-words">{message.text}</div> : null}
                <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-white/55">
                  <span>{formatDateTime(message.timestamp)}</span>
                  {outbound ? <CheckCheck size={13} className="text-sky-300" /> : null}
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="py-14 text-center text-sm text-white/55">تعذّر تحليل رسائل هذه المحادثة من المصدر.</div>
        )}
      </div>
    </div>
  );
}
