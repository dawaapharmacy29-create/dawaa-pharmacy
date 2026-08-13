import { describe, expect, it } from 'vitest';
import { parseMatrix, queueCode } from '@/components/customerService/SmartQueueExcelImportModal';

// Mirrors the exact column shape produced by exportExcel() in CustomerDailyPriorityQueues.tsx,
// for both the "المتابعة اليومية" sheet (VIP/+500/points) and the "ذكاء 3 فترات" sheet
// (3-period comparison), so a regression in either the export headers or the import parser
// shows up here instead of silently dropping rows in production.

function toMatrix(rows: Array<Record<string, unknown>>): unknown[][] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  return [headers, ...rows.map((row) => headers.map((h) => row[h]))];
}

describe('smart queue excel export/import round trip', () => {
  it('classifies VIP / +500 / points rows from the daily follow-up sheet', () => {
    expect(queueCode('VIP آخر 3 شهور')).toBe('vip_recent');
    expect(queueCode('+500')).toBe('plus500');
    expect(queueCode('نقاط')).toBe('points');
  });

  it('classifies every 3-cycle intelligence trend state into the activity bucket', () => {
    for (const state of ['خطر فقد', 'تراجع قوي', 'تراجع', 'نمو قوي', 'نمو', 'عميل صاعد جديد', 'مستقر']) {
      expect(queueCode(state)).toBe('activity');
    }
  });

  it('parses a filled-in daily follow-up row (VIP) with all result columns', () => {
    const matrix = toMatrix([
      {
        'نوع القائمة': 'VIP آخر 3 شهور',
        'الفرع': 'فرع الشامي',
        'اسم العميل': 'ناهد محمد',
        'كود العميل': '1213',
        'الهاتف': '01210676576',
        'حالة الاتجاه': 'مستقر',
        'الفترة الحالية': 5434.2,
        'الفترة السابقة': 5000,
        'الفترة قبل السابقة': 4800,
        'التغير عن المعتاد %': 10.9,
        'قيمة الفاتورة': '',
        'عدد الفواتير': 3,
        'رصيد النقاط': '',
        'مبيعات آخر 3 شهور': 15234.2,
        'ترتيب أهم 50': 4,
        'تمت المتابعة': 'نعم',
        'تم الرد': 'نعم',
        'رد العميل': 'العميل مبسوط بالخدمة',
        'عملية شراء': 'لا',
        'قيمة عملية الشراء': '',
        'هل يحتاج متابعة أخرى': 'لا',
        'موعد المتابعة القادمة': '',
        'ملاحظات': 'تم التأكيد مع العميل',
      },
    ]);
    const rows = parseMatrix(matrix);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.queueType).toBe('vip_recent');
    expect(row.branch).toBe('فرع الشامي');
    expect(row.customerCode).toBe('1213');
    expect(row.phone).toBe('01210676576');
    expect(row.followedUp).toBe(true);
    expect(row.responded).toBe(true);
    expect(row.purchaseAfterFollowup).toBe(false);
    expect(row.needsNextFollowup).toBe(false);
    expect(row.notes).toBe('تم التأكيد مع العميل');
  });

  it('parses a filled-in +500 row that needs a follow-up call scheduled', () => {
    const matrix = toMatrix([
      {
        'نوع القائمة': '+500',
        'الفرع': 'فرع شكري',
        'اسم العميل': 'احمد بكري',
        'كود العميل': '36',
        'الهاتف': '01223481562',
        'حالة الاتجاه': '',
        'الفترة الحالية': '',
        'الفترة السابقة': '',
        'الفترة قبل السابقة': '',
        'التغير عن المعتاد %': '',
        'قيمة الفاتورة': 5400,
        'عدد الفواتير': 1,
        'رصيد النقاط': '',
        'مبيعات آخر 3 شهور': '',
        'ترتيب أهم 50': '',
        'تمت المتابعة': 'نعم',
        'تم الرد': 'لا',
        'رد العميل': '',
        'عملية شراء': 'لا',
        'قيمة عملية الشراء': '',
        'هل يحتاج متابعة أخرى': 'نعم',
        'موعد المتابعة القادمة': '2026-08-15',
        'ملاحظات': 'حاولنا الاتصال مرتين بدون رد',
      },
    ]);
    const rows = parseMatrix(matrix);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.queueType).toBe('plus500');
    expect(row.followedUp).toBe(true);
    expect(row.responded).toBe(false);
    expect(row.needsNextFollowup).toBe(true);
    expect(row.nextFollowupDate).toBe('2026-08-15');
    expect(row.invoiceAmount).toBe(5400);
  });

  it('parses a filled-in 3-cycle intelligence row (تراجع قوي) with its own result columns', () => {
    const matrix = toMatrix([
      {
        'نوع القائمة': 'تراجع قوي',
        'الفرع': 'فرع الشامي',
        'الترتيب': 7,
        'اسم العميل': 'محمد جمال بخيت',
        'كود العميل': '10587',
        'الهاتف': '01044445551',
        'الحالة': 'تراجع قوي',
        'مبيعات آخر 3 شهور': 8000,
        'الفترة الحالية': 500,
        'الفترة السابقة': 2500,
        'الفترة قبل السابقة': 2600,
        'متوسط الفترتين السابقتين': 2550,
        'التغير عن الفترة السابقة %': -80,
        'التغير عن المعتاد %': -80.4,
        'فواتير الحالي': 1,
        'فواتير السابق': 4,
        'فواتير قبل السابق': 5,
        'آخر شراء': '2026-08-01',
        'درجة أولوية المتابعة': 10800,
        'تمت المتابعة': 'نعم',
        'تم الرد': 'نعم',
        'رد العميل': 'قال إنه بيشتري من فرع تاني أقرب لبيته الجديد',
        'عملية شراء': 'لا',
        'قيمة عملية الشراء': '',
        'هل يحتاج متابعة أخرى': 'نعم',
        'موعد المتابعة القادمة': '2026-08-20',
        'ملاحظات': 'عرضنا عليه خدمة توصيل مجانية',
      },
    ]);
    const rows = parseMatrix(matrix);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.queueType).toBe('activity');
    expect(row.customerCode).toBe('10587');
    expect(row.phone).toBe('01044445551');
    expect(row.followedUp).toBe(true);
    expect(row.responded).toBe(true);
    expect(row.needsNextFollowup).toBe(true);
    expect(row.notes).toBe('عرضنا عليه خدمة توصيل مجانية');
  });

  it('reads all sheets in a multi-sheet workbook independently (simulated by concatenation)', () => {
    const dailyMatrix = toMatrix([
      { 'نوع القائمة': 'نقاط', 'الفرع': 'فرع شكري', 'اسم العميل': 'سلمى صادق', 'كود العميل': '17337', 'الهاتف': '01000000000', 'تمت المتابعة': 'نعم', 'تم الرد': 'نعم', 'رد العميل': 'شكرته', 'عملية شراء': 'لا', 'قيمة عملية الشراء': '', 'هل يحتاج متابعة أخرى': 'لا', 'موعد المتابعة القادمة': '', 'ملاحظات': 'تم الإبلاغ بالنقاط' },
    ]);
    const intelMatrix = toMatrix([
      { 'نوع القائمة': 'نمو قوي', 'الفرع': 'فرع شكري', 'اسم العميل': 'مروه فايز', 'كود العميل': '5440', 'الهاتف': '01515892549', 'تمت المتابعة': 'نعم', 'تم الرد': 'نعم', 'رد العميل': 'مبسوطة جدًا', 'عملية شراء': 'نعم', 'قيمة عملية الشراء': 1500, 'هل يحتاج متابعة أخرى': 'لا', 'موعد المتابعة القادمة': '', 'ملاحظات': 'عميلة نمو ممتازة' },
    ]);
    const dailyRows = parseMatrix(dailyMatrix);
    const intelRows = parseMatrix(intelMatrix);
    expect(dailyRows[0].queueType).toBe('points');
    expect(intelRows[0].queueType).toBe('activity');
    expect(intelRows[0].purchaseAfterFollowup).toBe(true);
    expect(intelRows[0].purchaseAmount).toBe(1500);
  });

  it('rejects a sheet missing the required result columns instead of silently returning nothing', () => {
    const matrix = [
      ['اسم العميل', 'كود العميل'],
      ['عميل بلا نتيجة', '999'],
    ];
    expect(() => parseMatrix(matrix)).toThrow();
  });

  it('handles rows with a missing customer_code by falling back to name matching downstream', () => {
    const matrix = toMatrix([
      { 'نوع القائمة': '+500', 'الفرع': 'فرع الشامي', 'اسم العميل': 'عميل بدون كود', 'كود العميل': '', 'الهاتف': '', 'تمت المتابعة': 'لا', 'تم الرد': '', 'رد العميل': '', 'عملية شراء': '', 'قيمة عملية الشراء': '', 'هل يحتاج متابعة أخرى': '', 'موعد المتابعة القادمة': '', 'ملاحظات': '' },
    ]);
    const rows = parseMatrix(matrix);
    expect(rows).toHaveLength(1);
    expect(rows[0].customerCode).toBe('');
    expect(rows[0].customerName).toBe('عميل بدون كود');
    expect(rows[0].followedUp).toBe(false);
  });
});
