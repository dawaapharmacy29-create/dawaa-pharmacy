import { createInMemorySupabase } from '../../../src/lib/salesIntelligence/qa/__tests__/inMemorySupabase.testkit';
import { fixtureTables } from '../../../src/lib/salesIntelligence/qa/__tests__/selectedCaseFixtures.testkit';

const client: any = createInMemorySupabase(fixtureTables());
let rpcCalls = 0;
const baseRpc = client.rpc.bind(client);
client.rpc = (...args: any[]) => {
  rpcCalls += 1;
  return baseRpc(...args);
};

(globalThis as any).__DAWAA_FAKE_SUPABASE__ = {
  client,
  get reads() { return client.reads.length; },
  get rpcCalls() { return rpcCalls; },
};

export const supabase = client;
