// Reads an employee's WhatsApp text or voice transcript (Egyptian Arabic) into a draft manual punch.
// A draft only: the manager sees the original message next to it and presses save.
export type ParsedPunchType = 'check_in' | 'check_out';

export interface ParsedPunch {
  type: ParsedPunchType | null;
  /** Null when the message gives no day. */
  date: string | null;
  /** HH:MM on a 24h clock. With `ambiguous`, this is the morning reading. */
  time: string | null;
  /** The message said "9" with no morning or evening. */
  ambiguous: boolean;
}

const WORD_HOURS: Record<string, number> = {
  واحده: 1, واحد: 1, اتنين: 2, اثنين: 2, تلاته: 3, ثلاثه: 3, اربعه: 4, خمسه: 5, سته: 6, سبعه: 7,
  تمانيه: 8, تمنيه: 8, ثمانيه: 8, تسعه: 9, عشره: 10, حداشر: 11, احداشر: 11, اتناشر: 12, اطناشر: 12,
};

const MINUTE_PARTS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^\s*و\s*نص/, 30],
  [/^\s*و\s*ربع/, 15],
  [/^\s*و\s*تلت/, 20],
  [/^\s*و\s*خمسه/, 5],
  [/^\s*و\s*عشره/, 10],
  [/^\s*الا\s*ربع/, -15],
  [/^\s*الا\s*تلت/, -20],
  [/^\s*الا\s*خمسه/, -5],
  [/^\s*الا\s*عشره/, -10],
];

const DAY_NAMES: ReadonlyArray<readonly [RegExp, number]> = [
  [/الاحد/, 0],
  [/الاتنين|الاثنين/, 1],
  [/التلات|الثلاثاء/, 2],
  [/الاربع/, 3],
  [/الخميس/, 4],
  [/الجمعه/, 5],
  [/السبت/, 6],
];

const CHECK_IN = /حضرت(?!ك)|حضور|وصلت|جيت|دخلت|دخول|استلمت|بدات|فتحت/g;
const CHECK_OUT = /انصرفت|انصراف|مشيت|خرجت|خروج|روحت|قفلت|خلصت/g;

export function normalizeMessage(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/٫/g, '.')
    .toLowerCase();
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

const pad = (n: number) => String(n).padStart(2, '0');

function findDate(text: string, today: string): { date: string | null; rest: string } {
  const [year, month, day] = today.split('-').map(Number);
  const slash = /(?<![\d:.])(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*\d{2,4})?(?![\d:])/.exec(text);
  if (slash) {
    const d = Number(slash[1]);
    const m = Number(slash[2]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      const sameYear = `${year}-${pad(m)}-${pad(d)}`;
      return {
        date: sameYear > today ? `${year - 1}-${pad(m)}-${pad(d)}` : sameYear,
        rest: text.replace(slash[0], ' '),
      };
    }
  }
  if (/اول\s*(امبارح|امس)/.test(text)) return { date: addDays(today, -2), rest: text.replace(/اول\s*(امبارح|امس)/, ' ') };
  if (/امبارح|امس/.test(text)) return { date: addDays(today, -1), rest: text.replace(/امبارح|امس/, ' ') };
  if (/النهارده|انهارده|اليوم/.test(text)) return { date: today, rest: text.replace(/النهارده|انهارده|اليوم/, ' ') };
  const dayOfMonth = /يوم\s*(\d{1,2})(?![\d:.])/.exec(text);
  if (dayOfMonth && Number(dayOfMonth[1]) >= 1 && Number(dayOfMonth[1]) <= 31) {
    const d = Number(dayOfMonth[1]);
    const date = d > day
      ? new Date(Date.UTC(year, month - 2, d)).toISOString().slice(0, 10)
      : `${year}-${pad(month)}-${pad(d)}`;
    return { date, rest: text.replace(dayOfMonth[0], ' ') };
  }
  for (const [pattern, weekday] of DAY_NAMES) {
    if (pattern.test(text)) {
      const todayWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
      return { date: addDays(today, -((todayWeekday - weekday + 7) % 7)), rest: text.replace(pattern, ' ') };
    }
  }
  return { date: null, rest: text };
}

function wordsToDigits(text: string): string {
  const words = Object.keys(WORD_HOURS).join('|');
  return text
    .replace(new RegExp(`(ساعه)\\s*(${words})(?![ء-ي])`, 'g'), (_, a, w) => `${a} ${WORD_HOURS[w]}`)
    .replace(
      new RegExp(`(?<![ء-ي])(${words})(?=\\s*(?:و\\s*نص|و\\s*ربع|و\\s*تلت|الا\\s|صباحا|مساء|الصبح|بليل|العصر|الضهر|المغرب))`, 'g'),
      (w) => String(WORD_HOURS[w])
    );
}

type Period = 'am' | 'pm' | 'night' | 'noon' | null;

function findPeriod(text: string): Period {
  if (/بليل|الليل/.test(text)) return 'night';
  if (/الضهر|الظهر/.test(text)) return 'noon';
  if (/صباحا|الصبح|الفجر|فجرا|\d\s*(ص|am)(?![ء-يa-z])/.test(text)) return 'am';
  if (/مساء|العصر|المغرب|العشا|\d\s*(م|pm)(?![ء-يa-z])/.test(text)) return 'pm';
  return null;
}

function applyPeriod(hour: number, minute: number, period: Period): { time: string; ambiguous: boolean } {
  const clock = (h: number) => `${pad(h)}:${pad(minute)}`;
  if (hour === 0 || hour > 12) return { time: clock(hour), ambiguous: false };
  if (period === 'am') return { time: clock(hour === 12 ? 0 : hour), ambiguous: false };
  if (period === 'pm') return { time: clock(hour === 12 ? 12 : hour + 12), ambiguous: false };
  if (period === 'noon') return { time: clock(hour === 12 || hour >= 11 ? hour : hour + 12), ambiguous: false };
  // "1 بليل" is after midnight; "10 بليل" is before it.
  if (period === 'night') return { time: clock(hour === 12 ? 0 : hour <= 4 ? hour : hour + 12), ambiguous: false };
  return { time: clock(hour === 12 ? 0 : hour), ambiguous: true };
}

function findTime(segment: string): { time: string; ambiguous: boolean } | null {
  const exact = /(?<![\d/])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d/])/.exec(segment);
  if (exact) return applyPeriod(Number(exact[1]), Number(exact[2]), findPeriod(segment));
  const hourPattern = /(?<![\d/.:])(\d{1,2})(?![\d/.:])(?!\s*(?:ساعات|ساعه|دقايق|دقيقه|ايام|جنيه))/g;
  const afterWord = /ساعه\s*(\d{1,2})(?![\d/.:])/.exec(segment);
  const match = afterWord || hourPattern.exec(segment);
  if (!match) return null;
  let hour = Number(match[1]);
  if (hour > 24) return null;
  const after = segment.slice(match.index + match[0].length);
  let minute = 0;
  for (const [pattern, delta] of MINUTE_PARTS) {
    if (!pattern.test(after)) continue;
    if (delta < 0) {
      hour = hour === 1 ? 12 : hour - 1;
      minute = 60 + delta;
    } else {
      minute = delta;
    }
    break;
  }
  return applyPeriod(hour, minute, findPeriod(segment));
}

export function parseManualPunchMessage(message: string, today: string): ParsedPunch[] {
  const { date, rest } = findDate(normalizeMessage(message), today);
  const text = wordsToDigits(rest);
  const marks = [
    ...[...text.matchAll(CHECK_IN)].map((m) => ({ type: 'check_in' as const, index: m.index, end: m.index + m[0].length })),
    ...[...text.matchAll(CHECK_OUT)].map((m) => ({ type: 'check_out' as const, index: m.index, end: m.index + m[0].length })),
  ]
    .sort((a, b) => a.index - b.index)
    .filter((mark, i, all) => i === 0 || all[i - 1].type !== mark.type);

  if (!marks.length) {
    const found = findTime(text);
    return [{ type: null, date, time: found?.time || null, ambiguous: found?.ambiguous || false }];
  }
  return marks.map((mark, i) => {
    const after = text.slice(mark.end, marks[i + 1]?.index ?? text.length);
    const before = text.slice(i ? marks[i - 1].end : 0, mark.index);
    // A time already spoken for by the previous punch's segment must not be reused.
    const found = findTime(after) || (i === 0 ? findTime(before) : null);
    return { type: mark.type, date, time: found?.time || null, ambiguous: found?.ambiguous || false };
  });
}

function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function circularGap(a: number, b: number): number {
  const gap = Math.abs(a - b);
  return Math.min(gap, 1440 - gap);
}

/** "9" with no morning/evening takes whichever reading is nearest the employee's shift time. */
export function resolveAmbiguousTime(time: string, reference: string | null): { time: string; resolved: boolean } {
  if (!reference) return { time, resolved: false };
  const morning = minutes(time);
  const evening = (morning + 720) % 1440;
  const target = minutes(reference.slice(0, 5));
  const chosen = circularGap(evening, target) < circularGap(morning, target) ? evening : morning;
  return { time: `${pad(Math.floor(chosen / 60))}:${pad(chosen % 60)}`, resolved: true };
}
