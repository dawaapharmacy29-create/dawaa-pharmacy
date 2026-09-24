import type { WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { ArrowLeft, CheckCheck, FileText, Forward, Image as ImageIcon, Mic, MoreVertical, Paperclip, Phone, Search, UserRound, Video } from 'lucide-react';

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

function clock(value: Date): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit' }).format(value);
  } catch {
    return '';
  }
}

function dayKey(value: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  } catch {
    return '';
  }
}

function dayLabel(value: Date): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(value);
  } catch {
    return '';
  }
}

function cleanSender(sender: string | null | undefined): string | null {
  const value = String(sender ?? '').trim();
  if (!value || /^(you|me|صيدليات? دواء)$/i.test(value)) return null;
  return value;
}

function MediaContent({ message }: { message: WhatsAppParsedMessage }) {
  const isMedia = message.mediaPlaceholder || ['image', 'voice', 'video', 'document'].includes(message.kind);
  if (!isMedia) return null;

  if (message.mediaAvailable && message.mediaObjectUrl) {
    if (message.kind === 'image') {
      return <img src={message.mediaObjectUrl} alt={message.mediaFileName || 'صورة من المحادثة'} className="mb-1 max-h-72 w-full rounded-lg object-cover" />;
    }
    if (message.kind === 'voice') {
      return <audio controls src={message.mediaObjectUrl} className="mb-1 w-[260px] max-w-full" />;
    }
    if (message.kind === 'video') {
      return <video controls src={message.mediaObjectUrl} className="mb-1 max-h-72 w-full rounded-lg" />;
    }
  }

  const label = message.kind === 'image' ? 'صورة' : message.kind === 'voice' ? 'رسالة صوتية' : message.kind === 'video' ? 'فيديو' : 'مستند';
  const Icon = message.kind === 'image' ? ImageIcon : message.kind === 'voice' ? Mic : message.kind === 'video' ? Video : FileText;
  return (
    <div className="mb-1 flex min-w-[190px] items-center gap-3 rounded-lg bg-black/10 p-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/15"><Icon size={19} /></span>
      <div className="min-w-0">
        <div className="font-semibold">{label}</div>
        <div className="truncate text-[10px] opacity-65">{message.mediaFileName || (message.mediaAvailable === false ? 'الملف غير متاح في التصدير' : 'مرفق من المحادثة')}</div>
      </div>
    </div>
  );
}

export function WhatsAppConversationPanel({ messages, customerName, customerCode, customerPhone, branch, caseStartedAt, caseEndedAt }: Props) {
  let previousDay = '';
  let previousDirection: WhatsAppParsedMessage['direction'] | null = null;

  return (
    <div className="overflow-hidden rounded-xl border border-black/30 bg-[#0b141a] shadow-xl" dir="ltr">
      {/* WhatsApp-like top bar. Display metadata is reviewer context; no business logic is inferred here. */}
      <div className="flex items-center gap-3 border-b border-white/5 bg-[#202c33] px-3 py-2.5 text-[#e9edef]" dir="rtl">
        <ArrowLeft size={20} className="text-[#aebac1]" />
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#6a7175] text-white"><UserRound size={21} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{customerName || 'عميل غير مسمى'}{customerCode ? <span className="mr-1.5 font-normal text-[#aebac1]">#{customerCode}</span> : null}</div>
          <div className="truncate text-[11px] text-[#8696a0]">{customerPhone || 'رقم غير متاح'}{branch ? ` • ${branch}` : ''}</div>
        </div>
        <Search size={18} className="text-[#aebac1]" />
        <Phone size={18} className="text-[#aebac1]" />
        <MoreVertical size={19} className="text-[#aebac1]" />
      </div>

      <div className="border-b border-white/5 bg-[#111b21] px-3 py-1.5 text-center text-[10px] text-[#8696a0]" dir="rtl">
        المحادثة الأصلية كاملة • الجزء الحالي مميز بوضوح، والرسائل خارج حدوده باهتة فقط للحفاظ على السياق
      </div>

      <div
        className="max-h-[720px] overflow-y-auto px-3 py-3 sm:px-8"
        style={{
          backgroundColor: '#0b141a',
          backgroundImage: 'radial-gradient(rgba(255,255,255,.022) 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      >
        {messages.length ? messages.map((message) => {
          const inside = inCaseWindow(message, caseStartedAt, caseEndedAt);
          const key = dayKey(message.timestamp);
          const showDay = key !== previousDay;
          const sameSender = !showDay && previousDirection === message.direction;
          previousDay = key;
          previousDirection = message.direction;

          const separator = showDay ? (
            <div key={`${message.id}-day`} className="my-3 flex justify-center" dir="rtl">
              <span className="rounded-lg bg-[#182229] px-3 py-1.5 text-[10px] font-medium text-[#8696a0] shadow">{dayLabel(message.timestamp)}</span>
            </div>
          ) : null;

          if (message.direction === 'system') {
            return (
              <div key={message.id}>
                {separator}
                <div className={inside ? 'my-2 text-center' : 'my-2 text-center opacity-35'}>
                  <span className="inline-block max-w-[90%] rounded-lg bg-[#182229] px-3 py-1.5 text-[10px] leading-5 text-[#8696a0]" dir="rtl">
                    {message.text || `[${message.kind}]`}
                  </span>
                </div>
              </div>
            );
          }

          const outbound = message.direction === 'outbound';
          const sender = cleanSender(message.sender);
          return (
            <div key={message.id}>
              {separator}
              <div className={`flex ${outbound ? 'justify-end' : 'justify-start'} ${sameSender ? 'mt-0.5' : 'mt-2'} ${inside ? '' : 'opacity-30'}`}>
                <div
                  className={`relative max-w-[88%] px-2.5 pb-1.5 pt-1.5 text-[13px] leading-[1.45rem] text-[#e9edef] shadow-sm sm:max-w-[72%] ${
                    outbound
                      ? `bg-[#005c4b] ${sameSender ? 'rounded-lg' : 'rounded-lg rounded-tr-sm'}`
                      : `bg-[#202c33] ${sameSender ? 'rounded-lg' : 'rounded-lg rounded-tl-sm'}`
                  }`}
                  dir="rtl"
                >
                  {!sameSender && sender ? <div className="mb-0.5 text-[10px] font-semibold text-[#53bdeb]">{sender}</div> : null}
                  {message.forwarded ? <div className="mb-0.5 flex items-center gap-1 text-[10px] italic text-[#8696a0]"><Forward size={10} /> تمت إعادة التوجيه</div> : null}
                  <MediaContent message={message} />
                  {message.text ? <div className="whitespace-pre-wrap break-words">{message.text}</div> : null}
                  <div className="mt-[-2px] flex items-center justify-end gap-1 pr-2 text-[9px] leading-none text-[#8696a0]">
                    <span>{clock(message.timestamp)}</span>
                    {outbound ? <CheckCheck size={13} className="text-[#53bdeb]" /> : null}
                  </div>
                  {inside && !sameSender ? (
                    <span className={`absolute top-0 h-2.5 w-2.5 rotate-45 ${outbound ? '-right-1 bg-[#005c4b]' : '-left-1 bg-[#202c33]'}`} aria-hidden />
                  ) : null}
                </div>
              </div>
            </div>
          );
        }) : <div className="py-16 text-center text-sm text-[#8696a0]" dir="rtl">تعذّر تحليل رسائل هذه المحادثة من المصدر.</div>}
      </div>

      <div className="flex items-center gap-2 border-t border-white/5 bg-[#202c33] px-3 py-2 text-[#8696a0]">
        <Paperclip size={19} />
        <div className="flex-1 rounded-full bg-[#2a3942] px-4 py-2 text-right text-xs" dir="rtl">عرض للقراءة فقط — لا يمكن الإرسال من شاشة المراجعة</div>
        <Mic size={19} />
      </div>
    </div>
  );
}
