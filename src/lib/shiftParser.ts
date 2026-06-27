/* xlsx will be dynamically imported when needed for parsing */

export interface ParsedShift {
  isOff: boolean;
  start: string | null;
  end: string | null;
  hours: number | null;
  raw: string;
  writtenHours?: number | null;
  warnings?: string[];
  errors?: string[];
}

export interface ParsedStaffShifts {
  name: string;
  role: 'doctor' | 'assistant' | 'delivery' | 'staff';
  branch: string;
  shifts: Record<string, ParsedShift>;
}

export interface ScheduleImportIssue {
  level: 'error' | 'warning';
  staffName: string;
  branch: string;
  day: string;
  message: string;
  raw?: string;
  start?: string | null;
  end?: string | null;
  hours?: number | null;
  role?: ParsedStaffShifts['role'];
}

export interface ScheduleImportValidation {
  errors: ScheduleImportIssue[];
  warnings: ScheduleImportIssue[];
  valid: boolean;
}

export interface ParsedScheduleImport {
  staff: ParsedStaffShifts[];
  branchCount: number;
  staffCount: number;
  shiftCount: number;
  offCount: number;
  deliveryCount: number;
  doctorCount: number;
  validation: ScheduleImportValidation;
}

const DAY_ALIASES: Record<string, string> = {
  السبت: 'السبت',
  الاحد: 'الأحد',
  الأحد: 'الأحد',
  الاثنين: 'الاثنين',
  الإثنين: 'الاثنين',
  الاتنين: 'الاثنين',
  الثلاثاء: 'الثلاثاء',
  الاربعاء: 'الأربعاء',
  الأربعاء: 'الأربعاء',
  الخميس: 'الخميس',
  الجمعة: 'الجمعة',
};

function normalizeArabic(value: string) {
  return value
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

function normalizeDayName(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = normalizeArabic(text);
  const match = Object.keys(DAY_ALIASES).find((day) => normalizeArabic(day) === normalized);
  return match ? DAY_ALIASES[match] : null;
}

function isDayHeader(value: unknown) {
  return normalizeArabic(String(value ?? '')) === normalizeArabic('اليوم');
}

function normalizeAmPm(value: string) {
  return value.replace('ص', 'AM').replace('م', 'PM').toUpperCase();
}

function normalizeDigits(value: string) {
  return value
    .replace(/[٠١٢٣٤٥٦٧٨٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/[۰۱۲۳۴۵۶۷۸۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString());
}

function toHour(hour: string, ampm: string) {
  const normalized = normalizeDigits(hour).replace(',', '.');
  const parts = normalized.includes(':') ? normalized.split(':') : normalized.split('.');
  let value = Number.parseInt(parts[0], 10);
  if (parts[1]) {
    const minuteText = parts[1] === '5' ? '30' : parts[1].padEnd(2, '0').slice(0, 2);
    const minutes = Number.parseInt(minuteText, 10);
    if (Number.isFinite(minutes)) value += minutes / 60;
  }
  const suffix = normalizeAmPm(ampm);
  if (suffix === 'PM' && value !== 12) value += 12;
  if (suffix === 'AM' && value === 12) value = 0;
  return value;
}

function formatHour(value: number) {
  const normalized = ((value % 24) + 24) % 24;
  const hours = Math.floor(normalized);
  const minutes = Math.round((normalized - hours) * 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function writtenHoursFromText(text: string) {
  const match = normalizeDigits(text).match(/\((\d{1,2}(?:[.,]\d+)?)\s*(?:h|hr|hrs|ساعة|س)\)/i);
  if (!match) return null;
  const value = Number(String(match[1]).replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

const SHIFT_SEPARATOR = String.raw`(?:→|->|–|—|-|الى|إلى|الي|حتى|to)`;
const SHIFT_TIME = String.raw`(\d{1,2}(?::\d{1,2}|[.,]\d+)?)\s*(AM|PM|ص|م)`;

export function parseShiftTime(raw: unknown): ParsedShift | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (/إجازة|اجازة|off|راحة|غياب/i.test(text)) {
    return { isOff: true, start: null, end: null, hours: null, raw: text };
  }

  const normalizedText = normalizeDigits(text);
  const match = normalizedText.match(new RegExp(`${SHIFT_TIME}\\s*${SHIFT_SEPARATOR}\\s*${SHIFT_TIME}`, 'i'));

  if (!match) {
    const simple = normalizedText.match(
      new RegExp(`(\\d{1,2}):?(\\d{0,2})\\s*${SHIFT_SEPARATOR}\\s*(\\d{1,2}):?(\\d{0,2})`, 'i')
    );
    if (simple) {
      const sh = Number(simple[1]);
      const sm = Number(simple[2] || '0');
      const eh = Number(simple[3]);
      const em = Number(simple[4] || '0');
      if ([sh, sm, eh, em].every(Number.isFinite)) {
        const startH = sh + sm / 60;
        const endH = eh + em / 60;
        const crossesMidnight = endH <= startH;
        let hours = endH - startH;
        if (hours <= 0) hours += 24;
        const roundedHours = Number(hours.toFixed(1));
        const warnings = crossesMidnight
          ? ['الشيفت يعبر منتصف الليل؛ راجع اليوم التالي قبل الحفظ']
          : [];
        if (roundedHours > 12) {
          warnings.push(`مدة الشيفت المحسوبة ${roundedHours} ساعة؛ راجعها قبل الحفظ`);
        }
        return {
          isOff: false,
          start: formatHour(startH),
          end: formatHour(endH),
          hours: roundedHours,
          raw: text,
          warnings,
        };
      }
    }
    return {
      isOff: false,
      start: text,
      end: null,
      hours: null,
      raw: text,
      errors: ['وقت البداية أو النهاية غير واضح'],
    };
  }

  const startAmpm = normalizeAmPm(match[2]);
  const endAmpm = normalizeAmPm(match[4]);
  const startH = toHour(match[1], startAmpm);
  const endH = toHour(match[3], endAmpm);
  const crossesMidnight = endH <= startH;
  let hours = endH - startH;
  if (hours <= 0) hours += 24;
  const roundedHours = Number(hours.toFixed(1));
  const writtenHours = writtenHoursFromText(text);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (roundedHours > 12) {
    warnings.push(`مدة الشيفت المحسوبة ${roundedHours} ساعة؛ راجعها قبل الحفظ`);
  }
  if (writtenHours !== null && Math.abs(writtenHours - roundedHours) >= 0.25) {
    warnings.push(`المدة المكتوبة ${writtenHours} ساعة لا تطابق المحسوبة ${roundedHours} ساعة`);
  }
  if (roundedHours >= 18 || (match[3] === '12' && endAmpm === 'PM' && roundedHours > 12)) {
    warnings.push('احتمال خطأ AM/PM، راجع 12 PM مقابل 12 AM');
  }
  if (crossesMidnight) {
    warnings.push('الشيفت يعبر منتصف الليل؛ راجع اليوم التالي قبل الحفظ');
  }

  return {
    isOff: false,
    start: formatHour(startH),
    end: formatHour(endH),
    hours: roundedHours,
    raw: text,
    writtenHours,
    warnings,
    errors,
  };
}

function roleFromText(text: string): ParsedStaffShifts['role'] {
  if (/دليفري|delivery|مندوب|التوصيل/i.test(text)) return 'delivery';
  if (/مساعد|assistant/i.test(text)) return 'assistant';
  if (/الدكاترة|الصيادلة|دكتور|د\.|د\/|صيدلي|doctor/i.test(text)) return 'doctor';
  return 'staff';
}

function cleanStaffName(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^د\s*\/?\s*/i, 'د/ ')
    .trim();
}

function staffKey(branch: string, role: ParsedStaffShifts['role'], name: string) {
  return `${branch}|${role}|${normalizeArabic(name)}`;
}

function branchFromSheet(sheetName: string) {
  if (/شامي|الشامي|الشامى/i.test(sheetName)) return 'فرع الشامي';
  if (/أبو العزم|ابو العزم|العزم|شكري|شكرى/i.test(sheetName)) return 'فرع شكري';
  return sheetName || 'غير محدد';
}

export function parseExcelShifts(rows: unknown[][], branch = 'غير محدد'): ParsedStaffShifts[] {
  const staff = new Map<string, ParsedStaffShifts>();
  let headerRow: unknown[] | null = null;
  let headerDayIndex = 0;
  let headerStartIndex = 1;
  let activeRole: ParsedStaffShifts['role'] = 'doctor';
  let headerRole: ParsedStaffShifts['role'] = activeRole;

  for (const row of rows) {
    const hasAnyCell = row.some((cell) => String(cell ?? '').trim());
    if (!hasAnyCell) {
      headerRow = null;
      continue;
    }

    const rowText = row.map((cell) => String(cell ?? '')).join(' ');
    const detectedRole = roleFromText(rowText);
    if (detectedRole !== 'staff') activeRole = detectedRole;

    const dayColumn = row.findIndex(isDayHeader);
    if (dayColumn >= 0) {
      headerRow = row;
      headerDayIndex = dayColumn;
      headerStartIndex = dayColumn + 1;
      headerRole = activeRole;
      row.slice(headerStartIndex).forEach((cell) => {
        const name = cleanStaffName(cell);
        if (!name || name === 'NaN') return;
        const key = staffKey(branch, headerRole, name);
        if (!staff.has(key)) {
          staff.set(key, { name, role: headerRole, branch, shifts: {} });
        }
      });
      continue;
    }

    const day = normalizeDayName(row[headerDayIndex] ?? row[0]);
    if (!headerRow || !day) {
      if (detectedRole !== 'staff') headerRow = null;
      continue;
    }

    headerRow.slice(headerStartIndex).forEach((cell, index) => {
      const columnIndex = headerStartIndex + index;
      const name = cleanStaffName(cell);
      if (!name || name === 'NaN') return;
      const shift = parseShiftTime(row[columnIndex]);
      if (!shift) return;
      const key = staffKey(branch, headerRole, name);
      const current = staff.get(key) || { name, role: headerRole, branch, shifts: {} };
      if (current.shifts[day]) {
        current.shifts[day].warnings = [
          ...(current.shifts[day].warnings || []),
          'يوجد تكرار لنفس الموظف في نفس اليوم؛ سيتم عرض آخر شيفت مقروء في المعاينة',
        ];
      }
      current.shifts[day] = shift;
      staff.set(key, current);
    });
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
    validation: validateScheduleImport(staff),
  };
}

function issueFor(
  person: ParsedStaffShifts,
  day: string,
  shift: ParsedShift,
  level: ScheduleImportIssue['level'],
  message: string
): ScheduleImportIssue {
  return {
    level,
    staffName: person.name,
    branch: person.branch,
    day,
    message,
    raw: shift.raw,
    start: shift.start,
    end: shift.end,
    hours: shift.hours,
    role: person.role,
  };
}

export function validateScheduleImport(staff: ParsedStaffShifts[]): ScheduleImportValidation {
  const issues: ScheduleImportIssue[] = [];

  staff.forEach((person) => {
    Object.entries(person.shifts).forEach(([day, shift]) => {
      if (shift.isOff) return;

      const shiftErrors = shift.errors || [];
      if ((!shift.start || !shift.end) && shiftErrors.length === 0) {
        issues.push(issueFor(person, day, shift, 'error', 'وقت البداية أو النهاية ناقص'));
      }
      if (shift.hours !== null && shift.hours > 12) {
        issues.push(
          issueFor(person, day, shift, 'warning', `مدة الشيفت ${shift.hours} ساعة؛ راجعها قبل الحفظ`)
        );
      }
      shiftErrors.forEach((message) => issues.push(issueFor(person, day, shift, 'error', message)));
      (shift.warnings || []).forEach((message) =>
        issues.push(issueFor(person, day, shift, 'warning', message))
      );
    });
  });

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  return { errors, warnings, valid: errors.length === 0 };
}
