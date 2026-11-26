import { beforeEach, describe, expect, it } from 'vitest';
import {
  chatBase,
  kindOfName,
  markExportsDone,
  newExports,
} from '@/lib/customerServiceTasks/groupFolder';

const file = (name: string, lastModified: number, size = 100) =>
  ({ name, lastModified, size }) as unknown as File;
const folder = (files: File[]) => ({
  name: 'WhatsApp',
  async *values() {
    for (const f of files) yield { kind: 'file', name: f.name, getFile: async () => f };
  },
});

describe('group exports folder', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it('treats re-exports of the same chat as one chat', () => {
    expect(chatBase('WhatsApp Chat - جروب الطلبات شكري (2).zip')).toBe(
      chatBase('WhatsApp Chat - جروب الطلبات شكري.zip')
    );
    expect(kindOfName('WhatsApp Chat - متابعات الشامي.zip')).toBe('followups');
    expect(kindOfName('WhatsApp Chat - طلبات العملاء.zip')).toBe('requests');
    expect(kindOfName('WhatsApp Chat - دواء.zip')).toBeNull();
  });

  it('offers only the newest export of each chat, and nothing once it was saved', async () => {
    const old = file('WhatsApp Chat - طلبات شكري.zip', 1);
    const newer = file('WhatsApp Chat - طلبات شكري (1).zip', 5);
    const other = file('WhatsApp Chat - طلبات الشامي.zip', 3);
    const followups = file('WhatsApp Chat - متابعات شكري.zip', 9);
    const h = folder([old, newer, other, followups, file('notes.pdf', 9)]);

    const first = await newExports(h, 'requests');
    expect(first.map((e) => e.name)).toEqual([newer.name, other.name]);
    expect(first[0].keys).toHaveLength(2);

    markExportsDone(first[0].keys);
    expect((await newExports(h, 'requests')).map((e) => e.name)).toEqual([other.name]);
    expect((await newExports(h, 'followups')).map((e) => e.name)).toEqual([followups.name]);
  });
});
