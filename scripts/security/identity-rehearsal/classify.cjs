const fs=require('fs'),path=require('path');
const rows=JSON.parse(fs.readFileSync(process.argv[2])).filter(r=>r.kind==='d_function');
const srcDir=process.argv[3];
// collect client source text (non-test)
const files=[];(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){if(e.name==='__tests__'||e.name==='node_modules')continue;walk(p)}else if(/\.(ts|tsx)$/.test(e.name))files.push(p)}})(srcDir);
const src=files.map(f=>[f.replace(srcDir,'src'),fs.readFileSync(f,'utf8')]);
const out=[];
for(const r of rows){
 const def=r.ddl; const name=r.nm.replace(/^public\./,'').split('(')[0];
 const head=def.split('AS $')[0];
 if(!/\bp_actor_id\b/.test(head)) continue;
 const body=def.slice(def.indexOf('AS $'));
 const anon=/grant execute on function [^\n]+ to anon;/.test(def), auth=/to authenticated;/.test(def);
 const coalesceOverride=/coalesce\(\s*p_actor_id\s*,\s*public\.(dawaa_current_staff_account_id_strict|dawaa_request_staff_id)\(\)\s*\)/i.test(body);
 const compareGuard=/p_actor_id is not null and v_actor\.account_id is distinct from p_actor_id/i.test(body);
 const viaMonthly=/monthly_eval_actor\(p_actor_id\)/.test(body);
 const viaScope=/dawaa_customer_service_queue_scope_v3\(p_actor_id\)/.test(body);
 const viaFollowupActor=/dawaa_current_followup_actor_v2\(p_actor_id/.test(body);
 const direct=/(id(::text)?\s*=\s*p_actor_id|p_actor_id\s*=\s*\w+\.id)/i.test(body);
 const usesSession=/dawaa_current_staff_account_id_strict|dawaa_session_account_id_v1|dawaa_request_staff_id\(|employee_operating_actor_id|dawaa_require_[a-z_]*actor/.test(body);
 const writes=/\b(insert\s+into|update\s+public\.|update\s+\w+\s+set|delete\s+from)\b/i.test(body);
 const attributes=/(_by|actor_id|created_by|approved_by|reviewed_by|sent_by|completed_by)\s*=\s*(coalesce\()?p_actor_id/i.test(body)||/values\s*\([^)]*p_actor_id/i.test(body.replace(/\n/g,' '));
 const callers=src.filter(([f,t])=>t.includes(`'${name}'`)||t.includes(`"${name}"`)).map(([f])=>f);
 out.push({name,sig:r.nm,anon,auth,lang:/LANGUAGE sql/i.test(head)?'sql':'plpgsql',coalesceOverride,compareGuard,viaMonthly,viaScope,viaFollowupActor,direct,usesSession,writes,attributes,callers});
}
fs.writeFileSync(process.argv[4],JSON.stringify(out,null,1));
for(const o of out) console.log([o.name,o.anon?'anon':'-',o.lang,o.coalesceOverride?'COALESCE':'',o.compareGuard?'GUARD':'',o.viaMonthly?'MONTHLY':'',o.viaScope?'SCOPE':'',o.viaFollowupActor?'FUACTOR':'',o.direct?'DIRECT':'',o.usesSession?'SESSION':'',o.writes?'W':'',o.attributes?'ATTR':'',o.callers.join(';')].join(' | '));
