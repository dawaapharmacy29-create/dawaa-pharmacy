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
  const date = new Date(year, monthIndex + delta, 1);
  return { year: date.getFullYear(), monthIndex: date.getMonth() };
}

export function pharmacyCycleForDateV1(input: Date | string): SalesIntelligenceCycleScopeV1 {
  const date = typeof input === 'string' ? new Date(`${input.slice(0, 10)}T12:00:00`) : input;
  const year = date.getFullYear();
  const monthIndex = date.getMonth();
  const day = date.getDate();

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
  const anchor = new Date(`${scope.start}T12:00:00`);
  anchor.setDate(anchor.getDate() - 1);
  return pharmacyCycleForDateV1(anchor);
}

export function buildRecentPharmacyCyclesV1(
  anchor: Date = new Date(),
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
  const day = value.slice(0, 10);
  return day >= scope.start && day <= scope.end;
}

export function nextDayYmdV1(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return ymd(date.getFullYear(), date.getMonth(), date.getDate());
}
