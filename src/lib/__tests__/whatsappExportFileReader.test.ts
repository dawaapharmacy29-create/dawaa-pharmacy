import { describe, expect, it } from 'vitest';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';

const encoder = new TextEncoder();

function u16(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function storedZip(entries: Array<{ name: string; text?: string; bytes?: Uint8Array }>): Uint8Array {
  const localParts: number[] = [];
  const centralParts: number[] = [];
  const centralRows: Array<{ nameBytes: Uint8Array; data: Uint8Array; offset: number }> = [];

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.bytes ?? encoder.encode(entry.text ?? '');
    const offset = localParts.length;

    localParts.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
      ...data
    );
    centralRows.push({ nameBytes, data, offset });
  }

  const centralOffset = localParts.length;
  for (const row of centralRows) {
    centralParts.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(row.data.length),
      ...u32(row.data.length),
      ...u16(row.nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(row.offset),
      ...row.nameBytes
    );
  }

  const eocd = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(centralRows.length),
    ...u16(centralRows.length),
    ...u32(centralParts.length),
    ...u32(centralOffset),
    ...u16(0),
  ];

  return new Uint8Array([...localParts, ...centralParts, ...eocd]);
}

describe('readWhatsAppExportFile', () => {
  it('reads TXT exports directly', async () => {
    const raw = '[9/15/26, 9:30:55 PM] Customer: hello';
    const file = new File([raw], 'chat.txt', { type: 'text/plain' });
    const result = await readWhatsAppExportFile(file);

    expect(result.format).toBe('text');
    expect(result.text).toBe(raw);
    expect(result.innerFileName).toBe('chat.txt');
  });

  it('prefers chat.txt over chat.md inside ZIP and keeps media inventory', async () => {
    const txt = '[9/15/26, 9:30:55 PM] Customer: TXT source';
    const md = '## September 15, 2026\n\n[9:30 PM] **Customer:** MD source';
    const zip = storedZip([
      { name: 'chat.md', text: md },
      { name: 'chat.txt', text: txt },
      { name: 'IMG-20260915-WA0001.jpg', bytes: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const file = new File([zip], 'customer-export.zip', { type: 'application/zip' });
    const result = await readWhatsAppExportFile(file);

    expect(result.format).toBe('zip');
    expect(result.innerFileName).toBe('chat.txt');
    expect(result.text).toContain('TXT source');
    expect(result.text).not.toContain('MD source');
    expect(result.archiveEntries).toContain('chat.md');
    expect(result.archiveEntries).toContain('chat.txt');
    expect(result.mediaEntries).toEqual(['IMG-20260915-WA0001.jpg']);
    expect(result.mediaFiles?.[0].kind).toBe('image');
    expect(result.mediaFiles?.[0].byteSize).toBe(4);
  });

  it('rejects unsupported source files clearly', async () => {
    const file = new File(['x'], 'chat.csv', { type: 'text/csv' });
    await expect(readWhatsAppExportFile(file)).rejects.toThrow(
      'ارفع ملف WhatsApp بصيغة ZIP أو TXT أو MD.'
    );
  });
});
