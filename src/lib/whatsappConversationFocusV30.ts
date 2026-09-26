import type { WhatsAppConversationSession } from './whatsappConversationParser';
import type { ConversationTimingV28 } from './whatsappConversationTimingV28';
import type { DelayAttributionV29 } from './whatsappDelayAttributionV29';

export type ConversationFocusLevelV30 = 'primary' | 'supporting' | 'background';

export interface ConversationFocusMessageV30 {
  messageId: string;
  score: number;
  level: ConversationFocusLevelV30;
  reasons: string[];
  episodeId: string | null;
}

export interface ConversationFocusV30 {
  version: 'whatsapp-conversation-focus-v30';
  messageCount: number;
  primaryCount: number;
  supportingCount: number;
  backgroundCount: number;
  messages: ConversationFocusMessageV30[];
  focusedMessageIds: string[];
}

const ORDER_RX = /(عايز|عاوز|محتاج|ابعت|ابعث|هات|اطلب|أطلب|متوفر|موجود عندكم|بكام|السعر|اوردر|أوردر|طلب)/i;
const CONFIRM_RX = /(تم تأكيد|تم التاكيد|تم التأكيد|الأوردر اتأكد|الاوردر اتاكد|تم تسجيل الطلب|جاري الارسال|جاري الإرسال|خرج لحضرتك|هيتم التوصيل)/i;
const PROBLEM_RX = /(متاخر|متأخر|تاخير|تأخير|ماوصلش|موصلش|لسه مجاش|مشكله|مشكلة|غلط|شكوى|شكوي)/i;
const RECOVERY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|اسفين|آسفين|بنتابع|هنتابع|هنراجع|نعوض|تعويض|رضا حضرتك)/i;
const ACCEPT_RX = /(تمام|موافق|ماشي|خلاص|ابعت|ابعته|هات|اوكي|أوكي)/i;
const DECLINE_RX = /(لا شكرا|مش عايز|مش عاوز|غالي|مش مناسب|خلاص مش محتاج|مش هطلب)/i;
const CUSTOMER_DATA_RX = /((?:\+?20)?01[0125]\d{8}|العنوان|شارع|منطقه|منطقة|الدور|شقه|شقة|لوكيشن|موقع|عدد\s*\d+|كمية|كميه)/i;
// "د\s*[^\s]+" لازم يستنى مسافة فعلية بعد "د" - من غيرها بيتطابق غلط جوه أي كلمة
// بتبدأ بحرف الدال زي "داخلية"/"دواء" (لأن \s* كانت بتقبل صفر مسافة). (^|\s) قبلها
// عشان منمنعش الحالة العادية "معاك د اسلام" (حرف الدال بعد مسافة فعلية).
const STAFF_INTRO_RX = /(مع حضرتك|معاك|(^|\s)د\.?\s+[^\s،,.]+|خدمة عملاء)/i;
const FOLLOWUP_RX = /(حابين نطمن|حبيت اطمن|متابعه|متابعة|هتابع|هتواصل|اول ما|أول ما|هبلغ)/i;
const DELETED_RX = /(you deleted this message|this message was deleted|تم حذف هذه الرسالة|لقد حذفت هذه الرسالة)/i;

function add(map: Map<string, { score: number; reasons: string[] }>, id: string | null | undefined, score: number, reason: string) {
  if (!id) return;
  const row = map.get(id) || { score: 0, reasons: [] };
  row.score += score;
  if (!row.reasons.includes(reason)) row.reasons.push(reason);
  map.set(id, row);
}

function messageByIso(session: WhatsAppConversationSession, iso: string | null | undefined, direction?: 'inbound'|'outbound') {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  return session.messages.find((m) => (!direction || m.direction === direction) && Math.abs(m.timestamp.getTime() - target) <= 1000) || null;
}

export function buildConversationFocusV30(
  session: WhatsAppConversationSession,
  options: {
    scoredMessageIds?: string[];
    evidenceMessageIds?: string[];
    timing?: ConversationTimingV28 | null;
    delayAttribution?: DelayAttributionV29 | null;
  } = {},
): ConversationFocusV30 {
  const ordered = session.messages.slice().sort((a,b) => a.timestamp.getTime() - b.timestamp.getTime());
  const scores = new Map<string, { score: number; reasons: string[] }>();
  const indexById = new Map(ordered.map((m,i) => [m.id,i]));

  for (const id of options.scoredMessageIds || []) add(scores,id,45,'ضمن مسؤولية الموظف الجاري تقييمه');
  for (const id of options.evidenceMessageIds || []) add(scores,id,50,'دليل مباشر مستخدم في التقييم');

  const timing = options.timing;
  if (timing) {
    for (const turn of timing.responseTurns) {
      for (const id of turn.inboundMessageIds) add(scores,id,25,'Turn عميل له علاقة بزمن الرد');
      add(scores,turn.responseMessageId,28,turn.noResponse ? 'Turn بدون رد' : 'أول رد على Turn العميل');
    }
    const milestones: Array<[string|null, string, 'inbound'|'outbound'|undefined]> = [
      [timing.orderTimeline.requestAt,'بداية طلب/احتياج العميل','inbound'],
      [timing.orderTimeline.firstResponseAt,'أول رد على الطلب','outbound'],
      [timing.orderTimeline.confirmedAt,'تأكيد/تنفيذ الأوردر',undefined],
      [timing.orderTimeline.delayOrProblemAt,'ظهور التأخير أو المشكلة',undefined],
      [timing.orderTimeline.recoveryAt,'أول معالجة/Recovery','outbound'],
    ];
    for (const [at,reason,direction] of milestones) {
      const message = messageByIso(session,at,direction);
      add(scores,message?.id,40,reason);
    }
  }

  for (const id of options.delayAttribution?.evidenceMessageIds || []) add(scores,id,35,'دليل على سبب التأخير/المسؤولية التشغيلية');

  for (const message of ordered) {
    const text = String(message.text || '');
    if (DELETED_RX.test(text)) {
      add(scores,message.id,-60,'رسالة محذوفة لا تحمل محتوى دلاليًا');
      continue;
    }
    if (message.direction === 'inbound' && ORDER_RX.test(text)) add(scores,message.id,24,'طلب أو احتياج صريح من العميل');
    if (CONFIRM_RX.test(text)) add(scores,message.id,28,'تأكيد أوردر/تنفيذ');
    if (PROBLEM_RX.test(text)) add(scores,message.id,30,'مشكلة أو تأخير مؤثر');
    if (RECOVERY_RX.test(text)) add(scores,message.id,28,'اعتذار أو استعادة خدمة');
    if (message.direction === 'inbound' && ACCEPT_RX.test(text)) add(scores,message.id,18,'قبول/موافقة من العميل');
    if (message.direction === 'inbound' && DECLINE_RX.test(text)) add(scores,message.id,22,'رفض/اعتراض من العميل');
    if (CUSTOMER_DATA_RX.test(text)) add(scores,message.id,18,'بيانات تنفيذ/توصيل أو كمية');
    if (message.direction === 'outbound' && STAFF_INTRO_RX.test(text)) add(scores,message.id,10,'تعريف المسؤول');
    if (FOLLOWUP_RX.test(text)) add(scores,message.id,18,'وعد أو فرصة متابعة');
    if (['image','voice','video','document'].includes(message.kind)) add(scores,message.id,message.mediaAvailable ? 8 : 14,message.mediaAvailable ? 'مرفق داخل الرحلة' : 'مرفق غير متاح قد يخفي سياقًا');
  }

  // التماسك الحواري: الرسالة المهمة تحتاج الرسالة قبلها/بعدها غالبًا لفهم المقصود.
  const seedIds = [...scores.entries()].filter(([,row]) => row.score >= 25).map(([id]) => id);
  for (const id of seedIds) {
    const i = indexById.get(id);
    if (i == null) continue;
    for (const n of [i-1,i+1]) {
      if (n < 0 || n >= ordered.length) continue;
      const neighbor = ordered[n];
      const gap = Math.abs(neighbor.timestamp.getTime() - ordered[i].timestamp.getTime()) / 60000;
      if (gap <= 8) add(scores,neighbor.id,10,'سياق ملاصق لرسالة مهمة');
    }
  }

  const episodeByMessage = new Map<string,string>();
  for (const episode of timing?.episodes || []) for (const id of episode.messageIds) episodeByMessage.set(id,episode.id);

  const messages = ordered.map((message): ConversationFocusMessageV30 => {
    const row = scores.get(message.id) || { score: 0, reasons: [] };
    const score = Math.max(0,Math.min(100,row.score));
    const level: ConversationFocusLevelV30 = score >= 40 ? 'primary' : score >= 18 ? 'supporting' : 'background';
    return {
      messageId: message.id,
      score,
      level,
      reasons: row.reasons,
      episodeId: episodeByMessage.get(message.id) || null,
    };
  });

  return {
    version:'whatsapp-conversation-focus-v30',
    messageCount:messages.length,
    primaryCount:messages.filter((m) => m.level === 'primary').length,
    supportingCount:messages.filter((m) => m.level === 'supporting').length,
    backgroundCount:messages.filter((m) => m.level === 'background').length,
    messages,
    focusedMessageIds:messages.filter((m) => m.level !== 'background').map((m) => m.messageId),
  };
}
