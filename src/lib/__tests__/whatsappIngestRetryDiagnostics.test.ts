import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLocalWhatsAppFailedExports,
  getUnprocessedWhatsAppExports,
  markLocalWhatsAppFileFailed,
  markLocalWhatsAppFileProcessed,
  retryLocalWhatsAppFailedExport,
} from '@/lib/localWhatsAppInbox';
import { describeWhatsAppIngestError } from '@/lib/whatsappIngestError';

const exportFile = { name: 'حنان حمدي.zip', size: 8973, lastModified: 1790572500000 } as File;
const key = `${exportFile.name}|${exportFile.size}|${exportFile.lastModified}`;
const otherFile = { name: 'محادثة مؤكدة.zip', size: 1200, lastModified: 1790572600000 } as File;
const otherKey = `${otherFile.name}|${otherFile.size}|${otherFile.lastModified}`;

function folder() {
  return {
    queryPermission: async () => 'granted',
    async *values() {
      for (const file of [exportFile, otherFile]) yield { kind: 'file', name: file.name, getFile: async () => file };
    },
  };
}

describe('WhatsApp ingest failure visibility and safe retry', () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (name: string) => values.get(name) || null,
      setItem: (name: string, value: string) => { values.set(name, value); },
      removeItem: (name: string) => { values.delete(name); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('distinguishes exhausted failed exports from an empty inbox and only retries the selected key', async () => {
    markLocalWhatsAppFileProcessed(otherKey);
    for (let i = 0; i < 3; i += 1) markLocalWhatsAppFileFailed(key, 'حفظ المصدر: timeout');
    expect(await getUnprocessedWhatsAppExports(folder())).toHaveLength(0);
    expect(await getLocalWhatsAppFailedExports(folder())).toEqual([{
      key, name: exportFile.name, attempts: 3, reason: 'حفظ المصدر: timeout', retryAt: null,
    }]);
    expect(retryLocalWhatsAppFailedExport(key)).toBe(true);
    expect(retryLocalWhatsAppFailedExport(key)).toBe(false);
    expect((await getUnprocessedWhatsAppExports(folder())).map((item) => item.key)).toEqual([key]);
    expect((await getUnprocessedWhatsAppExports(folder(), 10, otherKey))).toHaveLength(0);
    expect((await getUnprocessedWhatsAppExports(folder(), 10, key)).map((item) => item.key)).toEqual([key]);
    expect(values.get('dawaa.whatsapp.localInbox.processed.v1')).toContain(otherKey);
  });

  it('retains structured backend diagnostics instead of reporting an unknown error', () => {
    expect(describeWhatsAppIngestError({ message: 'permission denied', code: '42501', details: 'source guard' }))
      .toBe('permission denied | source guard | 42501');
    expect(describeWhatsAppIngestError(new Error('invalid archive'))).toBe('invalid archive');
    expect(describeWhatsAppIngestError(null)).toContain('null');
  });
});
