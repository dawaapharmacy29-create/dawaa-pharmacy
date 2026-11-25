import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CompetitionPodium, { type PodiumWinner } from '../CompetitionPodium';

const winner = (name: string, points: string): PodiumWinner => ({
  key: name,
  name,
  branch: 'فرع شكري',
  headline: { value: points, label: 'نقطة من ١٠٠' },
  stats: [
    { label: 'المبيعات', value: '١٢٠٬٠٠٠ ج' },
    { label: 'الفواتير', value: '٤٣٠' },
    { label: 'متوسط الفاتورة', value: '٢٧٩ ج' },
    { label: 'طلبات العملاء', value: '٣٥' },
    { label: 'طلبات المتابعة', value: '١٢' },
  ],
});

describe('the winners podium', () => {
  it('shows the first in the gold card with all of what they did, then the second and third', () => {
    const html = renderToStaticMarkup(
      <CompetitionPodium
        title="الأوائل بالنقط لحد امبارح"
        winners={[winner('د دنيا', '82.5'), winner('د/ علا', '77.0'), winner('د اميرة', '70.1'), winner('د وائل', '60')]}
      />
    );
    if (process.env.PODIUM_HTML) writeFileSync(process.env.PODIUM_HTML, html);
    expect(html.indexOf('المركز الأول')).toBeLessThan(html.indexOf('د دنيا'));
    expect(html.indexOf('د دنيا')).toBeLessThan(html.indexOf('المركز التاني'));
    expect(html.indexOf('المركز التاني')).toBeLessThan(html.indexOf('د/ علا'));
    expect(html).toContain('المركز التالت');
    expect(html).not.toContain('د وائل');
    // الأول بكل بياناته، والتاني والتالت بأول أربعة.
    expect(html.match(/طلبات المتابعة/g)).toHaveLength(1);
  });

  it('shows nothing without winners', () => {
    expect(renderToStaticMarkup(<CompetitionPodium title="x" winners={[]} />)).toBe('');
  });
});
