import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { DailyTask } from '../api';
import {
  ONBOARDING_SHEET,
  ONBOARD_COLUMNS,
  onboardingDone,
  onboardingLeft,
  readOnboardingSheet,
  welcomeLink,
  type OnboardingTask,
} from '../onboarding';
import { TASKS_SHEET, buildTaskWorkbook, previousSteps, readTaskWorkbook } from '../sheet';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

const onboarding = (id: string, extra: Partial<OnboardingTask> = {}): OnboardingTask => ({
  id,
  queue_date: '2026-11-25',
  branch: 'فرع الشامي',
  source: 'uncoded_note',
  customer_code: null,
  customer_name: 'منى احمد',
  customer_phone: '01012345678',
  attempt_no: 1,
  assigned_name: 'هاجر',
  result: null,
  carried_from_date: null,
  invoice: '90211',
  value: 340,
  seller: 'د معاذ',
  invoice_at: '2026-11-24T18:20:00Z',
  note: 'منى احمد 01012345678 جديدة',
  items: [{ name: 'بانادول اكسترا', qty: 2 }],
  onboard: null,
  welcome: 'أهلاً بحضرتك أ/ منى احمد 🌷',
  code_check: null,
  ...extra,
});

const task = (id: string, source: string): DailyTask =>
  ({
    id,
    queue_date: '2026-11-25',
    branch: 'فرع الشامي',
    source,
    priority: '2',
    customer_code: '500',
    customer_name: 'عميل',
    customer_phone: '01099999999',
    reason: '',
    attempt_no: 1,
    assigned_staff_id: null,
    assigned_name: null,
    result: null,
    result_label: null,
    result_note: null,
    next_followup_date: null,
    last_contact: null,
  }) as DailyTask;

describe('onboarding steps', () => {
  it('needs the BeeConnect code only for a customer from the notes', () => {
    expect(onboardingDone('new_customer', { saved: true, welcome: 'sent' })).toBe(true);
    expect(onboardingDone('uncoded_note', { saved: true, welcome: 'sent' })).toBe(false);
    expect(onboardingLeft('uncoded_note', { saved: true, welcome: 'no_whatsapp' })).toEqual([
      'الكود',
    ]);
    expect(onboardingLeft('uncoded_note', {})).toEqual(['الكود', 'التليفون', 'الترحيب']);
    expect(onboardingDone('uncoded_note', { problem: 'wrong_number' })).toBe(true);
  });

  it('opens WhatsApp with the welcome already written', () => {
    expect(welcomeLink('01012345678', 'أهلاً')).toBe(
      `https://wa.me/201012345678?text=${encodeURIComponent('أهلاً')}`
    );
    expect(welcomeLink('0225555555', 'x')).toBeNull();
  });

  it('says what was done before and whether the customers file confirmed the code', () => {
    const text = previousSteps(
      onboarding(ID1, {
        carried_from_date: '2026-11-24',
        attempt_no: 2,
        onboard: { code: '20455', saved: true },
        code_check: { status: 'match' },
      })
    );
    expect(text).toContain('من يوم 24/11');
    expect(text).toContain('اتكود 20455');
    expect(text).toContain('ناقص: الترحيب');
    expect(text).toContain('اتأكد من ملف العملاء');
  });

  it('reads the steps by column title and flags what is not from the list', () => {
    const header = [
      'id',
      '#',
      'الاسم',
      ONBOARD_COLUMNS.code,
      ONBOARD_COLUMNS.saved,
      ONBOARD_COLUMNS.welcome,
      ONBOARD_COLUMNS.problem,
      ONBOARD_COLUMNS.note,
    ];
    const r = readOnboardingSheet([
      ['العملاء الجداد'],
      header,
      [ID1, 1, 'منى', '٢٠٤٥٥', 'اتسجل', 'اتبعتت', '', ''],
      [ID2, 2, 'سيد', '', 'اه', '', '', ''],
      [ID3, 3, 'هند', '', '', '', '', ''],
    ]);
    expect(r.updates).toEqual([
      { id: ID1, code: '20455', saved: 'yes', welcome: 'sent', problem: null, note: '' },
    ]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].problem).toContain('«اه» مش من القايمة');
  });
});

describe('the daily workbook with new customers', () => {
  it('puts new customers in their own first sheet and reads their steps back', async () => {
    const rows = [
      onboarding(ID1),
      onboarding(ID2, {
        source: 'new_customer',
        customer_code: '19732',
        customer_name: 'محمد محسن 19732',
      }),
    ];
    const blob = await buildTaskWorkbook(
      [task(ID1, 'uncoded_note'), task(ID2, 'new_customer'), task(ID3, 'lost')],
      '2026-11-25',
      'هاجر',
      rows
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets[0].name).toBe(ONBOARDING_SHEET);

    // المكالمات فيها الباقي بس.
    const calls = wb.getWorksheet(TASKS_SHEET)!;
    const callIds: string[] = [];
    calls.eachRow((row) => {
      const v = String(row.getCell(1).value ?? '');
      if (/^[0-9a-f-]{36}$/.test(v)) callIds.push(v);
    });
    expect(callIds).toEqual([ID3]);

    const ws = wb.getWorksheet(ONBOARDING_SHEET)!;
    const header = ws.getRow(5);
    const at = (title: string) => {
      let n = 0;
      header.eachCell((c, i) => {
        if (c.value === title) n = i;
      });
      return n;
    };
    let uncodedRow = 0;
    let newRow = 0;
    ws.eachRow((row, i) => {
      if (row.getCell(1).value === ID1) uncodedRow = i;
      if (row.getCell(1).value === ID2) newRow = i;
    });
    // اللي مش متكود الأول، والمتكود كوده مكتوب لوحده.
    expect(uncodedRow).toBeLessThan(newRow);
    expect(ws.getRow(newRow).getCell(at(ONBOARD_COLUMNS.code)).value).toBe('19732');
    expect(ws.getRow(uncodedRow).getCell(at(ONBOARD_COLUMNS.code)).value).toBe('');
    const wa = ws.getRow(uncodedRow).getCell(at('واتساب بالترحيب')).value as { hyperlink: string };
    expect(wa.hyperlink).toContain('https://wa.me/201012345678?text=');

    ws.getRow(uncodedRow).getCell(at(ONBOARD_COLUMNS.code)).value = '20455';
    ws.getRow(uncodedRow).getCell(at(ONBOARD_COLUMNS.saved)).value = 'اتسجل';
    ws.getRow(newRow).getCell(at(ONBOARD_COLUMNS.welcome)).value = 'اتبعتت';
    const filled = await wb.xlsx.writeBuffer();
    const back = await readTaskWorkbook(filled as ArrayBuffer, '2026-11-25');
    expect(back.onboarding).toEqual([
      { id: ID1, code: '20455', saved: 'yes', welcome: null, problem: null, note: '' },
      { id: ID2, code: null, saved: null, welcome: 'sent', problem: null, note: '' },
    ]);
    expect(back.problems).toEqual([]);
  });
});
