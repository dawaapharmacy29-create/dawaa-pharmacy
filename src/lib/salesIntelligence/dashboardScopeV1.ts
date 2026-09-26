export interface SalesIntelligenceCycleScopeV1 {
  key: string;
  start: string;
  end: string;
  label: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function ymd(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function addMonths(year: number, monthIndex: number, delta: number): { year: number; monthIndex: number } {
  const date = new Date(Date.UTC(year, monthIndex + delta, 1));
  return { year: date.getUTCFullYear(), monthIndex: date.getUTCMonth() };
}

function cairoDateKey(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function pharmacyCycleForDateV1(input: Date | string): SalesIntelligenceCycleScopeV1 {
  const dayKey = typeof input === 'string' ? input.slice(0, 10) : cairoDateKey(input);
  const [year, month, day] = dayKey.split('-').map(Number);
  const monthIndex = month - 1;

  const startMonth = day >= 26
    ? { year, monthIndex }
    : addMonths(year, monthIndex, -1);
  const endMonth = addMonths(startMonth.year, startMonth.monthIndex, 1);
  const start = ymd(startMonth.year, startMonth.monthIndex, 26);
  const end = ymd(endMonth.year, endMonth.monthIndex, 25);

  return {
    key: start,
    start,
    end,
    label: `${start} → ${end}`,
  };
}

export function previousPharmacyCycleV1(scope: SalesIntelligenceCycleScopeV1): SalesIntelligenceCycleScopeV1 {
  return pharmacyCycleForDateV1(previousDayYmdV1(scope.start));
}

export function buildRecentPharmacyCyclesV1(
  anchor: Date | string = new Date(),
  count = 6
): SalesIntelligenceCycleScopeV1[] {
  const cycles: SalesIntelligenceCycleScopeV1[] = [];
  let current = pharmacyCycleForDateV1(anchor);
  for (let index = 0; index < count; index += 1) {
    cycles.push(current);
    current = previousPharmacyCycleV1(current);
  }
  return cycles;
}

export function dateFallsInCycleV1(
  value: string | null | undefined,
  scope: SalesIntelligenceCycleScopeV1
): boolean {
  if (!value) return false;
  let day = value.slice(0, 10);
  if (value.length > 10) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) day = cairoDateKey(parsed);
  }
  return day >= scope.start && day <= scope.end;
}

export function nextDayYmdV1(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return ymd(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}


export function previousDayYmdV1(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return ymd(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function cairoTodayYmdV1(now: Date = new Date()): string {
  return cairoDateKey(now);
}
