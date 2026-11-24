import { describe, expect, it } from 'vitest';
import { isNonProductBasketName } from '@/lib/salesIntelligence/caseBasketEngine';

// Real line names observed in analysed WhatsApp cases (phone numbers replaced).
describe('basket lines must name something the customer can buy', () => {
  it.each([
    '<album message>', '<image omitted> عايزه دول', '<image omitted> سلام عليكم', '14 قطعة', '4 علب', '٣شريط', '55ج',
    'احاسب انستا', 'الحساب', 'بس الرقم', 'كده رقم فودافون', 'معلش سجل برقم 01000000000', 'الروشتة دي', 'كدا الاوردر',
    'اعرف سعره كام الاول', 'دا سعر العلب', 'دا بكام و', 'كام', 'هو', 'و', 'من ده', 'من دا', 'زيها بالضبط', 'لي بس اول نوع',
    'من النوع الأول', 'من كل نوع', 'ولا العلبه', 'الصغيره', 'الحقنه', 'موجود ان شاء الله', 'كنت عاوزه اغير',
    'مش عايز مضاد حيوي', 'بعد الفطار و الغداء اوصبح و بليل', 'حبوب. للمغص بس مش فاكره اسمه هو لون الحبايه ابيض',
    'بعتذر لحضرتك يا فندم, الصنف غير متوفر حاليًا من الشركة المنتجة', 'صورته كدا', 'يبقي كدا عاوز كام',
  ])('drops «%s»', (name) => expect(isNonProductBasketName(name)).toBe(true));

  it.each([
    'لبن', 'سرنجة', '2سرنجه', 'كالسيوم', 'فلاجيل', 'دوا فلاجيل', 'المايه', 'لاكسيول بى', 'كيتوفان 50', 'حقنه تيجو',
    'كنت محتاجه دافلون ١٠٠٠', 'معلش عايزة 3امبواات بلمكورت', 'من كل نوع وعلتين  لاكسيول', 'اختبار حمل بكام',
    'سبازمو ديجيستين و امبول فولتارين و اختبار حمل بعد اذن حضرتك', 'perfectil', 'لا عاوزه ٣ امبولات', 'شامبو نيزورال',
  ])('keeps «%s»', (name) => expect(isNonProductBasketName(name)).toBe(false));
});
