import { describe, expect, it } from 'vitest';
import { TEAM_ANNOUNCEMENT, cleanItemName, parseItems } from '@/lib/customerServiceTasks/groups';
import { bestMatch, buildIndex } from '@/lib/customerServiceTasks/productSearch';

const names = (details: string) => parseItems(details).map((i) => i.name);

describe('request lines that are not items', () => {
  it('drops addresses, call notes, nursing, supplier answers and mentions', () => {
    expect(names('acm novophane\nشكري القواتلي امتداد شارع كريستال عصفور')).toEqual([
      'acm novophane',
    ]);
    expect(names('Systane hydration UD 30 vial\nالطرشوبي قال مش متوفر دلوقتي')).toEqual([
      'Systane hydration UD 30 vial',
    ]);
    expect(names('هتحتاج تمريض بعد الساعة 9')).toEqual([]);
    expect(names('زاميول جل\nاحمد اجازة نتعامل بيوسف')).toEqual(['زاميول جل']);
    expect(names('بيتافوس 1 علبة\n@all')).toEqual(['بيتافوس']);
  });

  it('keeps the item when the doctor signed it first', () => {
    expect(names('د تسنيم بيبرونه بابلز ناتشورال لون بينك')[0]).toBe(
      'بيبرونه بابلز ناتشورال لون بينك'
    );
    expect(names('بلنديل 5')).toEqual(['بلنديل 5']);
  });

  it('keeps the item when a note is written next to it in brackets', () => {
    expect(
      names(
        'د. شيماء Systane hydration UD 30 vial ( مش موجود صيدليات ) · الطرشوبي قال مش متوفر دلوقتي'
      )
    ).toEqual(['Systane hydration UD 30 vial']);
    // قوس من غير ملاحظة بيفضل جزء من الاسم.
    expect(names('بيرفينادون الشريط ب 550 (3)')[0]).toContain('(3)');
  });

  it('cleans the names of items saved before the fix', () => {
    expect(cleanItemName('د تسنيم بيبرونه بابلز ناتشورال لون بينك')).toBe(
      'بيبرونه بابلز ناتشورال لون بينك'
    );
    expect(cleanItemName('Disynone اقراص')).toBe('Disynone اقراص');
  });

  it('tells a message to the team from a request', () => {
    expect(TEAM_ANNOUNCEMENT.test('ريجين مستورد يا دكاترة العلبة فيها ب ممكن نرشحه @all')).toBe(
      true
    );
    expect(TEAM_ANNOUNCEMENT.test('محمد كمال 01274852066 ريجين 1 علبة')).toBe(false);
  });
});

describe('matching a hand-typed item to the catalog', () => {
  const index = buildIndex([
    { code: '101', name: 'PLENDIL 5MG 30 TAB', price: 90, sold: 40 },
    { code: '102', name: 'PLENDIL 10MG 30 TAB', price: 120, sold: 10 },
    { code: '200', name: 'DISYNONE 250MG 20 TAB', price: 60, sold: 5 },
    { code: '300', name: 'PANADOL EXTRA 24 TAB', price: 50, sold: 300 },
  ]);
  it('finds the item with its strength', () => {
    expect(bestMatch(index, 'بلنديل 5')?.code).toBe('101');
    expect(bestMatch(index, 'Disynone اقراص')?.code).toBe('200');
  });
  it('matches nothing for a name that is not an item', () => {
    expect(bestMatch(index, 'نجوي ابراهيم')).toBeNull();
    expect(bestMatch(index, '55')).toBeNull();
  });
});
