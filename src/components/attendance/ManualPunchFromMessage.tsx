import { useState } from 'react';
import { MessageSquareText, Mic } from 'lucide-react';
import { readStoredStaffSessionToken } from '@/lib/supabase';
import {
  parseManualPunchMessage,
  resolveAmbiguousTime,
  type ParsedPunch,
} from '@/lib/attendance/manualPunchMessageParser';

const MAX_VOICE_BYTES = 3 * 1024 * 1024;

const VOICE_ERRORS: Record<string, string> = {
  voice_not_configured: 'تحويل الفويس لسه مش متفعل: مفتاح الخدمة ناقص. الرسايل المكتوبة شغالة.',
  voice_too_large: 'الفويس أكبر من 3 ميجا',
  voice_empty: 'مفيش كلام واضح في الفويس',
  not_authorized: 'مفيش صلاحية',
  invalid_or_expired_staff_session: 'الجلسة انتهت، سجل دخول تاني',
};

export interface PunchDraft {
  type: ParsedPunch['type'];
  date: string | null;
  time: string | null;
  note: string;
}

function toBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function transcribeVoice(file: File): Promise<string> {
  if (file.size > MAX_VOICE_BYTES) throw new Error('voice_too_large');
  const token = readStoredStaffSessionToken();
  if (!token) throw new Error('invalid_or_expired_staff_session');
  const response = await fetch('/api/manual-punch-transcribe', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      audioBase64: toBase64(await file.arrayBuffer()),
      mimeType: file.type,
      fileName: file.name,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.text) throw new Error(result?.error || 'voice_failed');
  return result.text as string;
}

const typeLabel = (type: ParsedPunch['type']) =>
  type === 'check_in' ? 'حضور' : type === 'check_out' ? 'انصراف' : 'النوع؟';

/** Fills the manual punch form from a message. It never saves: the form's own button does. */
export default function ManualPunchFromMessage(props: {
  today: string;
  /** The employee's shift time for a day and punch type, used to read "9" as morning or evening. */
  shiftTimeFor: (date: string, type: ParsedPunch['type']) => string | null;
  fallbackDate: string;
  onApply: (draft: PunchDraft) => void;
  fieldClass: string;
  buttonClass: string;
  mutedClass: string;
}) {
  const { today, shiftTimeFor, fallbackDate, onApply, fieldClass, buttonClass, mutedClass } = props;
  const [message, setMessage] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const punches = message.trim()
    ? parseManualPunchMessage(message, today).map((punch) => {
        if (!punch.time || !punch.ambiguous) return { ...punch, guessed: false };
        const read = resolveAmbiguousTime(punch.time, shiftTimeFor(punch.date || fallbackDate, punch.type));
        return { ...punch, time: read.time, guessed: true, unresolved: !read.resolved };
      })
    : [];
  const applyable = punches.filter((punch) => punch.type || punch.time || punch.date);
  const note = `من رسالة الموظف: ${message.trim().replace(/\s+/g, ' ').slice(0, 200)}`;

  const onVoice = async (file?: File) => {
    if (!file) return;
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      setMessage(await transcribeVoice(file));
    } catch (e) {
      setVoiceError(VOICE_ERRORS[e instanceof Error ? e.message : ''] || 'تعذر تحويل الفويس، اكتب الرسالة بإيدك');
    } finally {
      setVoiceBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-lg border border-violet-300/40 p-2 dark:border-violet-400/20">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] font-bold">
          <MessageSquareText size={13} /> من رسالة أو فويس الموظف
        </span>
        <label className={`flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold ${buttonClass}`}>
          <Mic size={12} /> {voiceBusy ? 'جارٍ التحويل…' : 'رفع فويس'}
          <input
            type="file"
            accept="audio/*,.opus,.ogg,.m4a,.mp3"
            className="hidden"
            disabled={voiceBusy}
            onChange={(e) => {
              void onVoice(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        placeholder="الصق رسالة الموظف هنا، مثلًا: امبارح مشيت الساعة 10 ونص بليل"
        aria-label="رسالة الموظف"
        className={`w-full ${fieldClass}`}
      />
      {voiceError ? (
        <p role="alert" className="text-[11px] font-bold text-rose-700 dark:text-rose-300">{voiceError}</p>
      ) : null}
      {message.trim() && !applyable.length ? (
        <p className={`text-[11px] ${mutedClass}`}>مفهمتش منها نوع البصمة ولا الوقت، سجلها بإيدك.</p>
      ) : null}
      {applyable.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {applyable.map((punch, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onApply({ type: punch.type, date: punch.date, time: punch.time, note })}
              className={`rounded-lg px-2 py-1 text-[11px] font-bold ${buttonClass}`}
            >
              املا: {typeLabel(punch.type)} · {punch.date ? punch.date.slice(5) : 'اليوم؟'} · {punch.time || 'الساعة؟'}
              {punch.guessed ? ' (حسب شيفته)' : ''}
            </button>
          ))}
          <span className={`text-[11px] ${mutedClass}`}>راجع البيانات تحت واضغط «سجّل البصمة».</span>
        </div>
      ) : null}
    </div>
  );
}
