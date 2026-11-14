import { describe, expect, it } from 'vitest';
import { parseGroupChat } from '@/lib/followupRequests/groupChatRequests';
import { doctorsOnShift, extractCustomerCode, extractPhone, extractRequestCandidates } from '../groupChatCustomerRequests';

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
  it('credits the sender, then the named doctor, then the only doctor punched in', () => {
    expect(found.find((c) => c.customerCode === '10963')).toMatchObject({ doctorId: 'ola', doctorReason: 'sender' });
    expect(found.find((c) => c.customerCode === '11780')).toMatchObject({ doctorId: 'aly', doctorReason: 'named' });
    expect(found.find((c) => c.customerPhone)).toMatchObject({ doctorId: 'mg', doctorReason: 'on_shift' });
    expect(found[0]).toMatchObject({ doctorId: null, doctorReason: 'none' });
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
