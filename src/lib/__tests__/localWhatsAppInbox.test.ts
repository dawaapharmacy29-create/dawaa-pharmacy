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
});
