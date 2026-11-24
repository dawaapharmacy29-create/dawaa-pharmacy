import { describe, expect, it } from 'vitest';
import { cleanIntroducedStaffName, extractIntroducedStaffName } from '@/lib/whatsappConversationParser';

const out = (text: string) => extractIntroducedStaffName({ direction: 'outbound', text });

describe('doctor name from the branch greeting', () => {
  it('stops at the greeting phrase instead of keeping the whole line', () => {
    const greeting = 'صيدليات دواء ترحب بكم 💚\nمع حضرتك د علا اقدر اساعد حضرتك ازاي 💊🥼؟\nخدمات التوصيل متاحه على مدار 24 ساعة ✨';
    expect(out(greeting)).toBe('علا');
  });

  it('reads two-word names and the hamza spelling', () => {
    expect(out('مع حضرتك د احمد عاطف أقدر أساعد حضرتك ازاي 💊🥼؟')).toBe('احمد عاطف');
    expect(out('مع حضرتك د بسمله أساعد حضرتك ازاي 💊🥼؟')).toBe('بسمله');
  });

  it('reads a name written without the doctor title', () => {
    expect(out('مع حضرتك محمد عمر اقدر اساعد حضرتك ازاي 💊🥼؟')).toBe('محمد عمر');
  });

  it('keeps the existing branch and customer service templates', () => {
    expect(out('مع حضرتك د دنيا من فرع شكري')).toBe('دنيا');
    expect(out('مع حضرتك هاجر من خدمة العملاء صيدليات دواء')).toBe('هاجر');
  });

  it('does not take ordinary replies as a name', () => {
    expect(out('تمام يا فندم مع حضرتك ان شاء الله')).toBeNull();
    expect(extractIntroducedStaffName({ direction: 'inbound', text: 'مع حضرتك د علا اقدر اساعد' })).toBeNull();
  });

  it('cleans a stored name that still carries the greeting', () => {
    expect(cleanIntroducedStaffName('يوسف اساعد حضرتك ازاي 💊🥼؟')).toBe('يوسف');
    expect(cleanIntroducedStaffName('مغازي اقدر اساعد حضرتك ازاي 💊🥼؟')).toBe('مغازي');
  });
});
