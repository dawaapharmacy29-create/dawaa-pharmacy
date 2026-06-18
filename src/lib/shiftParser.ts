/* xlsx will be dynamically imported when needed for parsing */

export interface ParsedShift {
  isOff: boolean;
  start: string | null;
  end: string | null;
  hours: number | null;
  raw: string;
}

export interface ParsedStaffShifts {
  name: string;
  role: 'doctor' | 'assistant' | 'delivery' | 'staff';
  branch: string;
  shifts: Record<string, ParsedShift>;
}

export interface ParsedScheduleImport {
  staff: ParsedStaffShifts[];
  branchCount: number;
  staffCount: number;
  shiftCount: number;
  offCount: number;
  deliveryCount: number;
  doctorCount: number;
}

const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

function toHour(hour: string, ampm: string) {
  const normalized = hour.replace(',', '.');
  const [hourPart, minutePart] = normalized.split('.');
  let value = Number.parseInt(hourPart, 10);
  if (minutePart) {
    const minutes =
      minutePart === '5' ? 30 : Number.parseInt(minutePart.padEnd(2, '0').slice(0, 2), 10);
    if (Number.isFinite(minutes)) value += minutes / 60;
  }
  if (ampm.toUpperCase() === 'PM' && value !== 12) value += 12;
  if (ampm.toUpperCase() === 'AM' && value === 12) value = 0;
  return value;
}

function formatHour(value: number) {
  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseShiftTime(raw: unknown): ParsedShift | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (/إجازة|اجازة|off|راحة|غياب/i.test(text))
    return { isOff: true, start: null, end: null, hours: null, raw: text };
  const match = text.match(
    /(\d{1,2}(?:[.,]\d+)?)\s*(AM|PM|ص|م)\s*(?:→|->|-|الى|إلى)\s*(\d{1,2}(?:[.,]\d+)?)\s*(AM|PM|ص|م)/i
  );
  if (!match) return { isOff: false, start: text, end: null, hours: null, raw: text };
  const startAmpm = match[2].replace('ص', 'AM').replace('م', 'PM');
  const endAmpm = match[4].replace('ص', 'AM').replace('م', 'PM');
  const startH = toHour(match[1], startAmpm);
  const endH = toHour(match[3], endAmpm);
  let hours = endH - startH;
  if (hours <= 0) hours += 24;
  return {
    isOff: false,
    start: formatHour(startH),
    end: formatHour(endH),
    hours: Number(hours.toFixed(1)),
    raw: text,
  };
}

function roleFromText(text: string): ParsedStaffShifts['role'] {
  if (/دليفري|delivery|مندوب/i.test(text)) return 'delivery';
  if (/مساعد|assistant/i.test(text)) return 'assistant';
  if (/دكتور|د\.|صيدلي|doctor/i.test(text)) return 'doctor';
  return 'staff';
}

function cleanStaffName(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^د\s*\/?\s*/i, 'د/ ')
    .trim();
}

function branchFromSheet(sheetName: string) {
  if (/شامي|الشامي|الشامى/i.test(sheetName)) return 'فرع الشامي';
  if (/أبو العزم|ابو العزم|العزم|شكري|شكرى/i.test(sheetName)) return 'فرع شكري';
  if (/شكري|شكرى/i.test(sheetName)) return 'فرع شكري';
  return sheetName || 'غير محدد';
}

export function parseExcelShifts(rows: unknown[][], branch = 'غير محدد'): ParsedStaffShifts[] {
  const staff = new Map<string, ParsedStaffShifts>();
  let headerRow: unknown[] | null = null;
  let role: ParsedStaffShifts['role'] = 'doctor';

  for (const row of rows) {
    const first = String(row[0] ?? '').trim();
    if (!first) continue;
    const rowText = row.map((cell) => String(cell ?? '')).join(' ');
    const detectedRole = roleFromText(rowText);
    if (detectedRole !== 'staff') role = detectedRole;
    if (/الدكاترة|الصيادلة/i.test(rowText)) role = 'doctor';
    if (/الدليفري|التوصيل|مندوب/i.test(rowText)) role = 'delivery';
    if (first === 'اليوم') {
      headerRow = row;
      row.slice(2).forEach((cell) => {
        const name = cleanStaffName(cell);
        if (name && name !== 'NaN' && !staff.has(name))
          staff.set(name, { name, role, branch, shifts: {} });
      });
      continue;
    }
    if (headerRow && DAYS.includes(first)) {
      headerRow.slice(2).forEach((cell, index) => {
        const name = cleanStaffName(cell);
        if (!name || name === 'NaN') return;
        const shift = parseShiftTime(row[index + 2]);
        if (!shift) return;
        const current = staff.get(name) || { name, role, branch, shifts: {} };
        current.shifts[first] = shift;
        staff.set(name, current);
      });
    }
  }

  return [...staff.values()].filter((item) => Object.keys(item.shifts).length > 0);
}

export async function parseShiftWorkbook(file: File) {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  return workbook.SheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    return parseExcelShifts(rows, branchFromSheet(sheetName));
  });
}

export async function parseScheduleImport(file: File): Promise<ParsedScheduleImport> {
  const staff = await parseShiftWorkbook(file);
  const branches = new Set(staff.map((item) => item.branch));
  const shifts = staff.flatMap((item) => Object.values(item.shifts));
  return {
    staff,
    branchCount: branches.size,
    staffCount: staff.length,
    shiftCount: shifts.filter((shift) => !shift.isOff).length,
    offCount: shifts.filter((shift) => shift.isOff).length,
    deliveryCount: staff.filter((item) => item.role === 'delivery').length,
    doctorCount: staff.filter((item) => item.role === 'doctor').length,
  };
}
