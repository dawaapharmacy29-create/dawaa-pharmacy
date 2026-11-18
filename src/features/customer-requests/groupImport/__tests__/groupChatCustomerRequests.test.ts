import { describe, expect, it } from 'vitest';
import { parseGroupChat } from '@/lib/followupRequests/groupChatRequests';
import {
  candidatesInPeriod, cycleOfDay, describeRequest, detectGroupBranch, doctorsOnShift, extractCustomerCode, extractPhone, extractRequestCandidates,
} from '../groupChatCustomerRequests';

const doctors = [{ staffId: 'aly', name: 'د/ علياء' }, { staffId: 'ola', name: 'د علا سامي' }, { staffId: 'mg', name: 'د/ مغازي' }];
const chat = [
  '[11/5/26, 2:50:01 AM] صيدليات دواء الشامي: 9509',
  '[11/5/26, 2:50:20 AM] صيدليات دواء الشامي: دنيا',
  '[11/5/26, 2:50:40 AM] صيدليات دواء الشامي: محتاجه مينا لاكس',
  '[11/5/26, 4:37:00 PM] صيدليات دواء الشامي: 01064471251/ ايمن الششتاوي',
  'انجكتافير فيال',
  '[11/5/26, 9:09:10 PM] صيدليات دواء الشامي: 11780 مهم جدا محتاج 4 د/علياء',
  '[11/8/26, 8:38:00 PM] Dr Ola Sami: مدام نورا كود 10963 محتاجه ناو بي١٢',
  '[11/2/26, 12:40:42 AM] Dr Ola Sami: شركة ايفا ٣٠٠٠',
  '[11/2/26, 12:41:03 AM] صيدليات دواء الشامي: تمام',
  '[11/7/26, 6:37:00 PM] صيدليات دواء الشامي: صيدليات دواء – الأقرب إليك',
  'تم استلام وتأكيد طلب حضراتكم:',
  '(j.b.c cream 100 gram)',
].join('\n');

describe('customer requests from the WhatsApp group', () => {
  const shifts = [
    { staffId: 'mg', from: '2026-11-05T15:00:00', to: '2026-11-05T23:30:00' },
    { staffId: 'aly', from: '2026-11-05T20:00:00', to: '2026-11-06T04:00:00' },
  ];
  const found = extractRequestCandidates(parseGroupChat(chat), doctors, shifts);

  it('finds requests with a customer code, a phone or a confirmation; skips prices and chatter', () => {
    expect(found.map((c) => c.customerCode ?? c.customerPhone ?? c.kind)).toEqual(['9509', '01064471251', '11780', '10963', 'confirmation']);
  });
  it('joins a request written over several quick messages', () => {
    expect(found[0].body).toContain('مينا لاكس');
  });
  it('credits only the sender or the named doctor; the pharmacy account alone credits nobody', () => {
    expect(found.find((c) => c.customerCode === '10963')).toMatchObject({ doctorId: 'ola', doctorReason: 'sender' });
    expect(found.find((c) => c.customerCode === '11780')).toMatchObject({ doctorId: 'aly', doctorReason: 'named' });
    // د/ مغازي was the only doctor punched in, but being on shift no longer credits (owner 2026-11-18).
    expect(found.find((c) => c.customerPhone)).toMatchObject({ doctorId: null, doctorReason: 'pharmacy_account', onShift: ['mg'] });
    expect(found[0]).toMatchObject({ doctorId: null, doctorReason: 'pharmacy_account' });
  });
  it('reads the customer name and what was asked for', () => {
    expect(found[0]).toMatchObject({ customerName: 'دنيا', details: 'محتاجه مينا لاكس' });
    expect(found.find((c) => c.customerPhone)).toMatchObject({ customerName: 'ايمن الششتاوي', details: 'انجكتافير فيال' });
    expect(describeRequest('ايهاب محمد كود 12781 محتاجه ميرنا لوب')).toEqual({ customerName: 'ايهاب محمد', details: 'محتاجه ميرنا لوب' });
    expect(describeRequest('01067016533/ خالد محمد/ اوفيوهيبتا')).toEqual({ customerName: 'خالد محمد', details: 'اوفيوهيبتا' });
    expect(describeRequest('01007482820 ---147---مدام رحاب\nبيسال عن عروض')).toEqual({ customerName: 'مدام رحاب', details: 'بيسال عن عروض' });
  });
  it('two customers sent a minute apart are two requests', () => {
    const two = extractRequestCandidates(parseGroupChat([
      '[11/17/26, 3:07:00 PM] صيدليات دواء ابو العزم: مجدي الرحماني 1703',
      'مينالاكس و برجاتون',
      '[11/17/26, 3:08:00 PM] صيدليات دواء ابو العزم: مصطفي عزت18216',
      'ابيكوتيل حقن',
    ].join('\n')), doctors, []);
    expect(two.map((c) => [c.customerCode, c.customerName, c.details])).toEqual([['1703', 'مجدي الرحماني', 'مينالاكس و برجاتون'], ['18216', 'مصطفي عزت', 'ابيكوتيل حقن']]);
  });
  it('finds the branch from the group title, the file name or the pharmacy account', () => {
    expect(detectGroupBranch('chat.zip', '26/1/2026، 12:38 - Dr Donia أنشأ مجموعة "طلبات العملاء فرع شكري"')).toBe('فرع شكري');
    expect(detectGroupBranch('طلبات عملاء فرع الشامي (1).zip', '')).toBe('فرع الشامي');
    expect(detectGroupBranch('chat.zip', '[11/17/26, 9:07:52 PM] صيدليات دواء الشامي: شريف طارق 9487')).toBe('فرع الشامي');
    expect(detectGroupBranch('chat.zip', '[11/17/26, 9:07:52 PM] Dr Ola: 9487')).toBeNull();
  });
  it('records the cycle of the newest message by default', () => {
    expect(cycleOfDay('2026-11-18')).toEqual({ start: '2026-10-26', end: '2026-11-25' });
    expect(cycleOfDay('2026-11-26')).toEqual({ start: '2026-11-26', end: '2026-12-25' });
    expect(cycleOfDay('2026-01-10')).toEqual({ start: '2025-12-26', end: '2026-01-25' });
    const all = extractRequestCandidates(parseGroupChat([
      '[10/20/26, 1:00:00 PM] Dr Ola Sami: سمير 9818 محتاج بانادول',
      '[11/17/26, 1:00:00 PM] Dr Ola Sami: هدير 9819 محتاجة فيتامين',
    ].join('\n')), doctors, []);
    expect(candidatesInPeriod(all, 'cycle')).toMatchObject({ from: '2026-10-26', to: '2026-11-17' });
    expect(candidatesInPeriod(all, 'cycle').list.map((c) => c.customerCode)).toEqual(['9819']);
    expect(candidatesInPeriod(all, 'two_cycles').list).toHaveLength(2);
    expect(candidatesInPeriod(all, 'all').list).toHaveLength(2);
  });
  it('reads the confirmed item', () => {
    expect(found.find((c) => c.kind === 'confirmation')?.confirmedItem).toBe('j.b.c cream 100 gram');
  });
  it('the same export gives the same fingerprints', () => {
    expect(extractRequestCandidates(parseGroupChat(chat), doctors, shifts).map((c) => c.fingerprint)).toEqual(found.map((c) => c.fingerprint));
  });
  it('codes and phones in Arabic digits and with the country code', () => {
    expect(extractPhone('الرقم ٠١٠٦٣٩٣٠٥٠٧')).toBe('01063930507');
    expect(extractPhone('+20 1006136165')).toBe('01006136165');
    expect(extractCustomerCode('01006136165 هدير')).toBeNull();
    expect(extractCustomerCode('سمير ٩٨١٨')).toBe('9818');
    expect(doctorsOnShift('2026-11-05T21:00:00', shifts)).toEqual(['mg', 'aly']);
  });
});
