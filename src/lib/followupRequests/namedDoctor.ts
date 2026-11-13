export interface NamedDoctorOption { staffId: string; name: string }

const TITLES = new Set(['د', 'دكتور', 'دكتوره']);
const LETTER = '[\u0600-\u06ff]';

const unify = (value: string) =>
  value.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ًٌٍَُِّْـ]/g, '');

const nameWords = (name: string) =>
  unify(name).split(/[\s/.*\-_]+/).filter((word) => word && !TITLES.has(word));

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The doctor a shared account's message is written for, when it names exactly one: the branch
 * phone posts "د/ مغازي روشتة عيون". A first name two doctors share ("احمد") only counts as the
 * full name, and a customer called "د امل" names nobody.
 */
export function findNamedDoctor(body: string, doctors: NamedDoctorOption[]): NamedDoctorOption | null {
  const text = unify(body);
  const words = doctors.map((doctor) => nameWords(doctor.name));
  const usage = new Map<string, number>();
  words.forEach((list) => new Set(list).forEach((word) => usage.set(word, (usage.get(word) || 0) + 1)));

  const found = new Map<string, NamedDoctorOption>();
  doctors.forEach((doctor, index) => {
    const list = words[index];
    if (!list.length) return;
    const phrases = [list.join(' '), ...list.filter((word) => word.length >= 3 && usage.get(word) === 1)];
    const named = phrases.some((phrase) => {
      const spaced = phrase.split(' ').map(escape).join('\\s+');
      return new RegExp(`(^|[^\u0600-\u06ff])د(كتور|كتوره)?[\\s/.*\\-_]*${spaced}(?!${LETTER})`).test(text);
    });
    if (named) found.set(doctor.staffId, doctor);
  });
  return found.size === 1 ? [...found.values()][0] : null;
}
