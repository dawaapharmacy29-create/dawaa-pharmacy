// Disposable PostgreSQL cluster on loopback only. Never reads DATABASE_URL or app credentials.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
const execute=promisify(execFile);
// PostgreSQL children on Windows can inherit pipe handles; wait for pg_ctl's exit,
// with ignored stdio, rather than waiting for descendants to close inherited pipes.
function control(file,args){return new Promise((resolve,reject)=>{
 const child=spawn(file,args,{windowsHide:true,stdio:'ignore'});
 child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('pg_ctl failed '+code)));
});}
const require=createRequire(import.meta.url);
export async function startLocalAttendancePostgres() {
 const bin=process.env.POSTGRES_BIN_DIR;
 if(!bin) throw Error('POSTGRES_BIN_DIR must name a locally installed PostgreSQL bin directory.');
 const {Pool}=require(process.env.PG_MODULE_PATH || 'pg');
 const folder=await mkdtemp(join(tmpdir(),'dawaa-attendance-isolated-'));
 const data=join(folder,'data');
 const tool=name=>join(bin,name+(process.platform==='win32'?'.exe':''));
 await execute(tool('initdb'),['-D',data,'-U','attendance_test','-A','trust','--encoding=UTF8','--no-locale'],{windowsHide:true});
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 await control(tool('pg_ctl'),['-D',data,'-l',join(folder,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c fsync=off`,'start']);
 const pool=new Pool({host:'127.0.0.1',port,user:'attendance_test',database:'postgres',max:8,connectionTimeoutMillis:5000,statement_timeout:15000});
 return {pool,folder,async close(){await pool.end();await control(tool('pg_ctl'),['-D',data,'-w','-m','fast','stop']);}};
}
