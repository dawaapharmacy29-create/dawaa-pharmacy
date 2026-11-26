import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LiberationTrend, { dailyTrend } from '@/components/inventory/LiberationTrend';

const trend = [
  { day: '2026-11-26', branch: 'فرع شكري', value: 2_650_245, expiry: 14_404, dead: 784_403 },
  { day: '2026-11-26', branch: 'فرع الشامي', value: 2_168_783, expiry: 11_291, dead: 775_435 },
  { day: '2026-11-27', branch: 'فرع شكري', value: 2_600_000, expiry: 14_000, dead: 760_000 },
  { day: '2026-11-27', branch: 'فرع الشامي', value: 2_150_000, expiry: 11_000, dead: null },
];

describe('capital day by day', () => {
  it('adds the branches per day; dead is unknown when one branch was not recorded', () => {
    const d = dailyTrend(trend);
    expect(d.map((x) => x.day)).toEqual(['2026-11-26', '2026-11-27']);
    expect(d[0].value).toBe(4_819_028);
    expect(d[0].dead).toBe(1_559_838);
    expect(d[1].dead).toBeNull();
  });

  it('renders both lines and the change since the first file', () => {
    const html = renderToStaticMarkup(<LiberationTrend trend={trend} />);
    expect(html).toContain('رأس المال نزل');
    expect((html.match(/<path /g) ?? []).length).toBe(2);
  });

  it('says the line starts from the second file when there is only one', () => {
    const html = renderToStaticMarkup(<LiberationTrend trend={trend.slice(0, 2)} />);
    expect(html).toContain('ده أول ملف');
  });
});
