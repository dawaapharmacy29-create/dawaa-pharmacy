export interface DoctorOption { staffId: string; name: string }

type Part = { consonant: string } | { vowel: string; optional?: boolean; trailingWaw?: boolean };

const TITLES = new Set(['dr', 'doctor', 'doc', 'ph', 'pharm', 'pharmacist', 'د', 'دكتور', 'دكتوره', 'الدكتور', 'الدكتوره']);
const ARABIC = /[\u0600-\u06ff]/;
const LATIN_VOWELS = 'aeiouyw';
const VOWEL_MATCHES: Record<string, string> = { a: 'ae', o: 'ouw', i: 'iey' };
const CONSONANTS: Record<string, string> = {
  ب: 'b', ت: 't', ث: 't', ج: 'g', ح: 'h', خ: 'x', د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'S', ص: 's',
  ض: 'd', ط: 't', ظ: 'z', غ: 'g', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h',
};

const unifyArabic = (value: string) => value.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

const tokens = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z\u0600-\u06ff\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !TITLES.has(unifyArabic(word)))
    .map((word) => (ARABIC.test(word) ? unifyArabic(word) : word));

const dropArabicArticle = (word: string) => (word.length > 3 ? word.replace(/^ال/, '') : word);
const dropLatinArticle = (word: string) => (word.length > 4 ? word.replace(/^(el|al)/, '') : word);

function latinSounds(word: string): string {
  const sounds = word
    .replace(/kh/g, 'x').replace(/sh/g, 'S').replace(/gh/g, 'g').replace(/ph/g, 'f')
    .replace(/th/g, 't').replace(/dh/g, 'd').replace(/q/g, 'k').replace(/c/g, 'k').replace(/j/g, 'g');
  return sounds.replace(/(.)\1+/g, '$1');
}

/** What an Arabic spelling requires: its consonants and written long vowels, not its unwritten short ones. */
function arabicParts(word: string): Part[] {
  const parts: Part[] = [];
  [...word].forEach((letter, index, letters) => {
    const first = index === 0;
    const last = index === letters.length - 1;
    if (letter === 'ع' || letter === 'ء' || letter === 'ئ' || letter === 'ؤ') return;
    if (letter === 'ه' && last) return;
    if (letter === 'ا') { if (!first) parts.push({ vowel: 'a' }); return; }
    if (letter === 'و') {
      if (first) parts.push({ consonant: 'w' });
      else parts.push(last ? { vowel: 'o', optional: true, trailingWaw: true } : { vowel: 'o' });
      return;
    }
    if (letter === 'ي') {
      if (first) parts.push({ consonant: 'y' });
      else parts.push(last ? { vowel: 'i', optional: true } : { vowel: 'i' });
      return;
    }
    if (CONSONANTS[letter]) parts.push({ consonant: CONSONANTS[letter] });
  });
  return parts;
}

/** How well a Latin spelling fits an Arabic one; null when it cannot be the same name. */
function wordScore(arabic: string, latin: string): number | null {
  const sounds = latinSounds(latin);
  let position = 0;
  let score = 0;
  for (const part of arabicParts(arabic)) {
    if ('consonant' in part) {
      while (position < sounds.length && sounds[position] !== part.consonant && LATIN_VOWELS.includes(sounds[position])) position += 1;
      if (sounds[position] !== part.consonant) return null;
      position += 1;
      score += 1;
      continue;
    }
    const start = position;
    while (position < sounds.length && LATIN_VOWELS.includes(sounds[position]) && !VOWEL_MATCHES[part.vowel].includes(sounds[position])) position += 1;
    if (position < sounds.length && VOWEL_MATCHES[part.vowel].includes(sounds[position])) {
      position += 1;
      score += 1;
      continue;
    }
    position = start;
    if (!part.optional) return null;
    // A silent final و only fits a spelling like "Amr": "Omar" has a vowel before its last letter and is عمر.
    if (part.trailingWaw) {
      if (position !== sounds.length || LATIN_VOWELS.includes(sounds[position - 2] ?? '')) return null;
      score += 1;
    }
  }
  const rest = sounds.slice(position);
  return /^[aeiouywh]*$/.test(rest) ? score : null;
}

/** Arabic names lose "ال" but Latin ones cannot blindly: "Elkholy" has it, "Aliaa" does not. */
function latinScore(word: string, latin: string): number | null {
  const scores = [wordScore(word, latin), wordScore(word, dropLatinArticle(latin))].filter((score): score is number => score !== null);
  return scores.length ? Math.max(...scores) : null;
}

function doctorScore(senderWords: string[], doctorWords: string[]): number | null {
  const available = [...senderWords];
  let total = 0;
  // Someone saved as just "Dr Amr" can only be compared on the first name.
  const wanted = senderWords.length === 1 ? doctorWords.slice(0, 1) : doctorWords;
  for (const word of wanted) {
    let best = -1;
    let bestScore = -1;
    available.forEach((candidate, index) => {
      const score = ARABIC.test(candidate) ? (candidate === word ? word.length + 1 : null) : latinScore(word, candidate);
      if (score !== null && score > bestScore) {
        best = index;
        bestScore = score;
      }
    });
    if (best < 0) return null;
    total += bestScore;
    available.splice(best, 1);
  }
  return total;
}

/** The one doctor a WhatsApp name clearly belongs to. A tie returns null so nobody is credited by guesswork. */
export function matchSenderToDoctor(sender: string, doctors: DoctorOption[]): DoctorOption | null {
  const senderWords = tokens(sender).map(dropArabicArticle);
  if (!senderWords.length) return null;
  let winner: DoctorOption | null = null;
  let top = 0;
  let tied = false;
  for (const doctor of doctors) {
    const doctorWords = tokens(doctor.name).map(dropArabicArticle);
    if (!doctorWords.length) continue;
    const score = doctorScore(senderWords, doctorWords);
    if (score === null || score === 0) continue;
    if (score > top) {
      winner = doctor;
      top = score;
      tied = false;
    } else if (score === top && doctor.staffId !== winner?.staffId) {
      tied = true;
    }
  }
  return tied ? null : winner;
}
