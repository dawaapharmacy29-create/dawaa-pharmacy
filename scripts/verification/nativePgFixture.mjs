// Optional loopback-only adapter for the existing Batch 4 matrix. Never accepts a remote DB.
import { pathToFileURL } from 'node:url';
export async function nativePgFixture() {
  const url = new URL(process.env.DAWAA_NATIVE_PG_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.pathname !== '/dawaa_batch4_verification') throw new Error('Native rehearsal requires the dedicated loopback fixture DB');
  const pg = await import(process.env.DAWAA_PG_MODULE ? pathToFileURL(process.env.DAWAA_PG_MODULE).href : 'pg');
  const Client = pg.Client || pg.default.Client;
  const connect = async () => {
    const client = new Client({ connectionString: url.href, application_name: 'dawaa_batch4_parity' });
    await client.connect();
    await client.query("SET statement_timeout='10s'; SET deadlock_timeout='250ms'");
    return client;
  };
  const client = await connect();
  const version = (await client.query("SELECT current_setting('server_version_num')::int version, current_database() db")).rows[0];
  if (Math.floor(version.version / 10000) !== 17) { await client.end(); throw new Error('Native verification requires PostgreSQL 17'); }
  return {
    native: true, connectPeer: connect,
    query: (sql, args = []) => client.query(sql, args),
    async exec(sql) { const r = await client.query(sql); return (Array.isArray(r) ? r : [r]).map(x => ({ rows: x.rows || [] })); },
    close: () => client.end(),
  };
}
