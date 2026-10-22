import { createInMemorySupabase } from '../../../src/lib/salesIntelligence/qa/__tests__/inMemorySupabase.testkit';
import { fixtureTables } from '../../../src/lib/salesIntelligence/qa/__tests__/selectedCaseFixtures.testkit';

export const STAFF_SESSION_STORAGE_KEY = 'dawaa_staff_session_token_v1';
export const isSupabaseConfigured = false;
export function readStoredStaffSessionToken(): string | null { return null; }
export function buildDawaaRequestHeaders(initHeaders?: HeadersInit): Headers { return new Headers(initHeaders); }

const client: any = createInMemorySupabase(fixtureTables());
let rpcCalls = 0;
const baseRpc = client.rpc.bind(client);
client.rpc = (...args: any[]) => {
  rpcCalls += 1;
  return baseRpc(...args);
};
client.auth = {
  signIn: async () => ({ data: null, error: null }),
  signOut: async () => ({ error: null }),
  user: () => null,
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
};
client.storage = { from: () => ({ upload: async () => ({ data: null, error: null }) }) };

(globalThis as any).__DAWAA_FAKE_SUPABASE__ = {
  client,
  get reads() { return client.reads.length; },
  get rpcCalls() { return rpcCalls; },
};

export const supabase = client;
