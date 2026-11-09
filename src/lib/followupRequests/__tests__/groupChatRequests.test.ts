import { describe, expect, it } from 'vitest';
import { parseGroupChat } from '../groupChatRequests';

const header = '[11/8/26, 12:02:07 AM]';

describe('parseGroupChat', () => {
  it('counts an image with follow-up wording as a request', () => {
    expect(parseGroupChat(`${header} Dr Donia: <تم حذف الصورة> بنتها تعبانه نتطمن عليها`)[0]).toMatchObject({
      sender: 'Dr Donia', verdict: 'request', hasImage: true, sentAtLocal: '2026-11-08T00:02:07', body: 'بنتها تعبانه نتطمن عليها',
    });
  });
  it('keeps a multi-line message as one request', () => {
    const parsed = parseGroupChat(`${header} Dr Donia: <تم حذف الصورة> كانت طلبت تسعير\nنبقى نتابع معاها`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].verdict).toBe('request');
  });
  it('sends follow-up wording with no image to review', () => {
    expect(parseGroupChat(`${header} Dr A: محتاجين نتابع النواقص`)[0].verdict).toBe('review');
  });
  it('sends an image with no follow-up wording to review', () => {
    expect(parseGroupChat(`${header} Dr A: <تم حذف الصورة> تمام`)[0].verdict).toBe('review');
  });
  it('ignores side talk', () => {
    expect(parseGroupChat(`${header} Dr A: صباح الخير يا شباب`)[0].verdict).toBe('ignored');
  });
  it('drops WhatsApp notices and deleted messages', () => {
    expect(parseGroupChat(`[11/8/26, 1:00:00 AM] Ali added Omar\n[11/8/26, 1:01:00 AM] Dr A: تم حذف هذه الرسالة`)).toEqual([]);
  });
  it('reads an afternoon time', () => {
    expect(parseGroupChat('[11/8/26, 3:15:00 PM] Dr A: نتابع')[0].sentAtLocal).toBe('2026-11-08T15:15:00');
  });
  it('reads day-first files when a day is above 12', () => {
    expect(parseGroupChat('[25/10/26, 9:00:00 AM] Dr A: نتابع')[0].sentAtLocal).toBe('2026-10-25T09:00:00');
  });
  it('reads the Android export format', () => {
    expect(parseGroupChat('11/8/26, 9:05 PM - Dr A: <Media omitted> نتابع')[0]).toMatchObject({ verdict: 'request', sentAtLocal: '2026-11-08T21:05:00' });
  });
  it('strips the invisible marks WhatsApp adds', () => {
    expect(parseGroupChat('‎[11/8/26, 12:02:07 AM] Dr A: ‎<تم حذف الصورة> نتابع')[0].verdict).toBe('request');
  });
});
