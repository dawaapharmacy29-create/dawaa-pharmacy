import { normalizeTaskEvidence, type TaskEvidence } from './taskEvidence';
import { cairoDateBoundaryIso } from '@/lib/time/cairoDateBoundary';

type Row = {
  id:string; branch?:string|null; status?:string|null; request_type?:string|null;
  doctor_id?:string|null; primary_responsible_id?:string|null; source_assigned_staff_id?:string|null; source_recorded_staff_id?:string|null;
  requested_at?:string|null; created_at?:string|null; updated_at?:string|null; due_date?:string|null; next_action_at?:string|null; last_action_at?:string|null; closed_at?:string|null;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean=(v:unknown)=>String(v||'').trim();
const iso=(v:unknown)=>{const x=clean(v);if(!x)return null;const n=Date.parse(x);return Number.isFinite(n)?new Date(n).toISOString():null;};
const endDay=(v:unknown)=>{const x=clean(v);if(!x)return null;return x.includes('T')?iso(x):cairoDateBoundaryIso(x,true);};

export function customerRequestToTaskEvidence(row:Row,observedAt=new Date().toISOString()):TaskEvidence|null{
 const candidates=[row.primary_responsible_id,row.source_assigned_staff_id];
 const staffId=candidates.map(clean).find(v=>UUID.test(v))||null;
 const branch=clean(row.branch), sourceId=clean(row.id);
 if(!staffId||!branch||!sourceId)return null;
 const state=clean(row.status).toLowerCase().replace(/\s+/g,'_');
 const cancelled=['cancelled','canceled','ملغي','ملغى'].includes(state);
 const completed=Boolean(row.closed_at)||['closed','delivered','completed','done','مكتمل'].includes(state);
 const expectedAt=iso(row.next_action_at)||endDay(row.due_date);
 const accepted=Boolean(row.last_action_at);
 const overdue=!cancelled&&!completed&&Boolean(expectedAt)&&Date.parse(expectedAt!)<Date.parse(observedAt);
 const status=cancelled?'cancelled':completed?'completed':overdue?'missed':accepted?'accepted':'assigned';
 const completedAt=iso(row.closed_at||row.updated_at);
 const occurredAt=completedAt||iso(row.last_action_at||row.updated_at||row.requested_at||row.created_at)||observedAt;
 return normalizeTaskEvidence({
  sourceType:'customer_request',sourceId,taskKey:clean(row.request_type)||'customer_request',subjectStaffId:staffId,branch,status,
  expectedAt,assignedAt:iso(row.requested_at||row.created_at),acceptedAt:accepted?(iso(row.last_action_at)||occurredAt):null,
  completedAt:status==='completed'?(completedAt||occurredAt):null,occurredAt,
  cancellationReason:status==='cancelled'?'source_status_cancelled':null,outcome:clean(row.status)||null,
  metadata:{sourceStatus:clean(row.status)||null}
 });
}
