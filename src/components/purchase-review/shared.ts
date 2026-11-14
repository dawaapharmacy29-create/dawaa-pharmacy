export const money = (value: number) => Math.round(value).toLocaleString('ar-EG');

export const count = (value: number) => Math.round(value).toLocaleString('ar-EG');

export const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' });

export const weekdayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
  });

export const monthLabel = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-15T12:00:00`).toLocaleDateString('ar-EG', {
    month: 'long',
    year: 'numeric',
  });

export const shortBranch = (branch: string) => branch.replace(/^فرع\s*/, '');

/** «يوم ١٦ ← ١٥» for a supplier whose bill starts on the 16th. */
export function billingLabel(monthStartDay: number) {
  if (monthStartDay <= 1) return 'من أول الشهر';
  return `من ${count(monthStartDay)} لـ ${count(monthStartDay - 1)}`;
}
