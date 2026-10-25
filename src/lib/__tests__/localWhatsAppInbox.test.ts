import { describe, expect, it } from 'vitest';
import { getUnprocessedWhatsAppExports } from '@/lib/localWhatsAppInbox';

describe('getUnprocessedWhatsAppExports', () => {
  it('reports revoked folder permission instead of returning a valid-looking empty inbox', async () => {
    let valuesCalled = false;
    const handle = {
      queryPermission: async () => 'denied' as PermissionState,
      values: () => {
        valuesCalled = true;
        return [][Symbol.iterator]();
      },
    };

    const errorMessage = await getUnprocessedWhatsAppExports(handle).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error))
    );
    expect(errorMessage).toBe('local_whatsapp_folder_permission_not_granted');
    expect(valuesCalled).toBe(false);
  });

  it('carries the picked folder name with every export as branch provenance', async () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    const file = new File(['[9/1/26, 10:00:00 AM] عميل: السلام عليكم'], 'عميل 1234.zip', { lastModified: 1 });
    const handle = {
      name: 'محادثات شكري',
      queryPermission: async () => 'granted' as PermissionState,
      values: async function* () { yield { kind: 'file', name: file.name, getFile: async () => file }; },
    };
    const [candidate] = await getUnprocessedWhatsAppExports(handle);
    expect(candidate.name).toBe('عميل 1234.zip');
    expect(candidate.folderName).toBe('محادثات شكري');
  });
});
