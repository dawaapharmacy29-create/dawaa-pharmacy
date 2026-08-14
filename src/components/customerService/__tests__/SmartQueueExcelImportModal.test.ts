import { describe, expect, it } from 'vitest';
import { parseMatrix, queueCode } from '@/components/customerService/SmartQueueExcelImportModal';

function toMatrix(rows: Array<Record<string, unknown>>): unknown[][] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  return [headers, ...rows.map((row) => headers.map((h) => row[h]))];
}

describe('smart queue excel export/import round trip', () => {
  it('classifies VIP / +500 / points / exceptional rows', () => {
    expect(queueCode('VIP آخر 3 شهور')).toBe('vip_recent');
    expect(queueCode('+500')).toBe('plus500');
    expect(queueCode('نقاط')).toBe('points');
    expect(queueCode('متابعة استثنائية')).toBe('exceptional');
  });

  it('classifies every 3-cycle intelligence trend state into the activity bucket', () => {
    for (const state of ['خطر فقد', 'تراجع قوي', 'تراجع', 'نمو قوي', 'نمو', 'عميل صاعد جديد', 'مستقر']) {
      expect(queueCode(state)).toBe('activity');
    }
  });

  it('parses a filled-in daily follow-up row (VIP) with all result columns', () => {
    const matrix = toMatrix([{
      'نوع القائمة': 'VIP آخر 3 شهور', 'الفرع': 'فرع الشامي', 'اسم العميل': 'ناهد محمد', 'كود العميل': '1213', 'الهاتف': '01210676576',
      'حالة الاتجاه': 'مستقر', 'الفترة الحالية': 5434.2, 'الفترة السابقة': 5000, 'الفترة قبل السابقة': 4800, 'التغير عن المعتاد %': 10.9,
      'قيمة الفاتورة': '', 'عدد الفواتير': 3, 'رصيد النقاط': '', 'مبيعات آخر 3 شهور': 15234.2, 'ترتيب أهم 50': 4,
      'تمت المتابعة': 'نعم', 'تم الرد': 'نعم', 'رد العميل': 'العميل مبسوط بالخدمة', 'عملية شراء': 'لا', 'قيمة عملية الشراء': '',
      'هل يحتاج متابعة أخرى': 'لا', 'موعد المتابعة القادمة': '', 'ملاحظات': 'تم التأكيد مع العميل',
    }]);
    const row = parseMatrix(matrix)[0];
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
    const matrix = toMatrix([{
      'نوع القائمة': '+500', 'الفرع': 'فرع شكري', 'اسم العميل': 'احمد بكري', 'كود العميل': '36', 'الهاتف': '01223481562',
      'قيمة الفاتورة': 5400, 'تمت المتابعة': 'نعم', 'تم الرد': 'لا', 'رد العميل': '', 'عملية شراء': 'لا', 'قيمة عملية الشراء': '',
      'هل يحتاج متابعة أخرى': 'نعم', 'موعد المتابعة القادمة': '2026-08-15', 'ملاحظات': 'حاولنا الاتصال مرتين بدون رد',
    }]);
    const row = parseMatrix(matrix)[0];
    expect(row.queueType).toBe('plus500');
    expect(row.followedUp).toBe(true);
    expect(row.responded).toBe(false);
    expect(row.needsNextFollowup).toBe(true);
    expect(row.nextFollowupDate).toBe('2026-08-15');
    expect(row.invoiceAmount).toBe(5400);
  });

  it('parses a 3-cycle intelligence row', () => {
    const matrix = toMatrix([{
      'نوع القائمة': 'تراجع قوي', 'الفرع': 'فرع الشامي', 'اسم العميل': 'محمد جمال بخيت', 'كود العميل': '10587', 'الهاتف': '01044445551',
      'تمت المتابعة': 'نعم', 'تم الرد': 'نعم', 'رد العميل': 'انتقل إلى مكان جديد', 'عملية شراء': 'لا', 'قيمة عملية الشراء': '',
      'هل يحتاج متابعة أخرى': 'نعم', 'موعد المتابعة القادمة': '2026-08-20', 'ملاحظات': 'عرضنا عليه خدمة توصيل مجانية',
    }]);
    const row = parseMatrix(matrix)[0];
    expect(row.queueType).toBe('activity');
    expect(row.customerCode).toBe('10587');
    expect(row.responded).toBe(true);
    expect(row.needsNextFollowup).toBe(true);
  });

  it('parses exceptional source followup id so import can update the original request', () => {
    const matrix = toMatrix([{
      'نوع القائمة': 'متابعة استثنائية', 'الفرع': 'فرع الشامي', 'اسم العميل': 'عميل استثنائي', 'كود العميل': '8850', 'الهاتف': '01146990699',
      'معرف المتابعة': '95d9212f-a884-44b7-8ee4-6dcb18d6d5d4', 'تمت المتابعة': 'نعم', 'تم الرد': 'نعم', 'رد العميل': 'تم الاطمئنان',
      'عملية شراء': 'لا', 'قيمة عملية الشراء': '', 'هل يحتاج متابعة أخرى': 'لا', 'موعد المتابعة القادمة': '', 'ملاحظات': 'تم تنفيذ طلب الدكتور بالكامل',
    }]);
    const row = parseMatrix(matrix)[0];
    expect(row.queueType).toBe('exceptional');
    expect(row.sourceFollowupId).toBe('95d9212f-a884-44b7-8ee4-6dcb18d6d5d4');
    expect(row.followedUp).toBe(true);
  });

  it('parses points balance even when the primary queue is exceptional', () => {
    const matrix = toMatrix([{
      'نوع القائمة': 'متابعة استثنائية', 'الفرع': 'فرع شكري', 'اسم العميل': 'عميل نقاط واستثنائي', 'كود العميل': '17', 'الهاتف': '01099767693',
      'معرف المتابعة': '278982d4-682b-4b86-b28e-ec8a264e8908', 'رصيد النقاط': 450, 'تمت المتابعة': 'نعم', 'تم الرد': 'نعم', 'رد العميل': 'تم إبلاغه بالنقاط',
      'عملية شراء': 'لا', 'قيمة عملية الشراء': '', 'هل يحتاج متابعة أخرى': 'لا', 'موعد المتابعة القادمة': '', 'ملاحظات': 'تم إبلاغ العميل بكل التفاصيل',
    }]);
    const row = parseMatrix(matrix)[0];
    expect(row.queueType).toBe('exceptional');
    expect(row.pointsBalance).toBe(450);
  });

  it('rejects a sheet missing the required result columns', () => {
    expect(() => parseMatrix([['اسم العميل', 'كود العميل'], ['عميل بلا نتيجة', '999']])).toThrow();
  });

  it('handles rows with a missing customer_code by falling back to name matching downstream', () => {
    const matrix = toMatrix([{
      'نوع القائمة': '+500', 'الفرع': 'فرع الشامي', 'اسم العميل': 'عميل بدون كود', 'كود العميل': '', 'الهاتف': '',
      'تمت المتابعة': 'لا', 'تم الرد': '', 'رد العميل': '', 'عملية شراء': '', 'قيمة عملية الشراء': '', 'هل يحتاج متابعة أخرى': '', 'موعد المتابعة القادمة': '', 'ملاحظات': '',
    }]);
    const row = parseMatrix(matrix)[0];
    expect(row.customerCode).toBe('');
    expect(row.customerName).toBe('عميل بدون كود');
    expect(row.followedUp).toBe(false);
  });
});
