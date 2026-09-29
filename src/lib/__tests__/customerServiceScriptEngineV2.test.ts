import { describe, expect, it } from 'vitest';
import {
  buildFollowupScript,
  buildVipCareScript,
  buildWelcomeMessageScript,
} from '@/lib/customerServiceScriptEngine';

const base = {
  customerName: 'نورهان محمد',
  agentName: 'نور',
};

function allPublicText(pack: ReturnType<typeof buildFollowupScript>) {
  return [pack.opening, pack.closing, pack.whatsapp].join(' ');
}

describe('customerServiceScriptEngine V2 communication policy', () => {
  it('does not leak products, medical details, or banned wording into customer-facing text', () => {
    const pack = buildFollowupScript({
      ...base,
      source: 'doctor_request',
      reason: 'متابعة مرطب وغسول بسبب نقص حديد',
      profileTags: ['monthly_treatment', 'has_children'],
    });

    const text = allPublicText(pack);
    expect(text).not.toMatch(/مرطب|غسول|حديد|أطفال|علاج شهري/i);
    expect(text).not.toMatch(/احتياجات حضرتك|بشكل عام|إزعاج|ازعاج/i);
    expect(pack.whatsapp).toContain('نور');
    expect(pack.whatsapp).not.toContain('د/ نور');
  });

  it('preserves an explicit doctor title without inventing it for non-doctor agents', () => {
    const doctorPack = buildFollowupScript({
      ...base,
      agentName: 'د/ ضحى',
      reason: 'متابعة العميل',
    });

    expect(doctorPack.whatsapp).toContain('د/ ضحى');
  });

  it('uses a privacy-safe travel followup without exposing travel details or country', () => {
    const pack = buildFollowupScript({
      ...base,
      reason: 'العميلة غير نشطة بسبب سفرها إلى السعودية',
    });

    expect(pack.title).toBe('متابعة تقدير واطمئنان');
    expect(pack.whatsapp).not.toMatch(/سفر|السعودية|دولة/i);
    expect(pack.whatsapp).toContain('نشكرك على ثقتك');
  });

  it('switches bereavement cases to a human-only condolence path with no selling', () => {
    const pack = buildFollowupScript({
      ...base,
      reason: 'مرتجع بعد وفاة الطفل',
    });

    expect(pack.title).toBe('تعزية ومساندة');
    expect(pack.whatsapp).toContain('قدر الله وما شاء فعل');
    expect(pack.objective).toContain('بدون أي بيع');
    expect(pack.questions).toHaveLength(0);
  });

  it('handles complaints without assuming the pharmacy is at fault', () => {
    const pack = buildFollowupScript({
      ...base,
      reason: 'شكوى من تجربة الطلب',
    });

    const text = [
      pack.opening,
      pack.closing,
      pack.whatsapp,
      ...pack.objections.map((item) => item.response),
    ].join(' ');

    expect(pack.title).toBe('احتواء ملاحظة أو شكوى');
    expect(text).not.toMatch(/أصلح الخطأ|حق حضرتك|غلطنا|خطأنا/i);
    expect(pack.whatsapp).toContain('نراجع التفاصيل');
  });

  it('keeps profile personalization inside operator questions and out of WhatsApp', () => {
    const pack = buildFollowupScript({
      ...base,
      profileTags: ['monthly_treatment', 'has_children'],
    });

    expect(pack.questions.some((question) => /متابعة دورية/.test(question))).toBeTruthy();
    expect(pack.whatsapp).not.toMatch(/علاج|أطفال|فيتامين|لقاح|كوزمو|مكمل/i);
  });

  it('does not expose VIP classification in the customer-facing message', () => {
    const pack = buildVipCareScript({
      ...base,
      segment: 'مهم جدًا',
    });

    expect(pack.whatsapp).not.toMatch(/VIP|مهم جدًا|أهم عملاء/i);
    expect(pack.whatsapp).toContain('بنقدّر جدًا ثقة حضرتك');
  });

  it('keeps the welcome message short, warm, and non-pushy', () => {
    const pack = buildWelcomeMessageScript(base);

    expect(pack.whatsapp.length).toBeLessThan(420);
    expect(pack.whatsapp).not.toMatch(/خيارك الأساسي|احتياجات حضرتك|بشكل عام/i);
    expect(pack.whatsapp).toContain('تحت أمر حضرتك');
  });
});
