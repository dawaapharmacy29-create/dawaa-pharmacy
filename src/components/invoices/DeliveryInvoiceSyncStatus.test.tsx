import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
const query=vi.hoisted(()=>({value:{} as Record<string,unknown>}));
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({...query.value,refetch:vi.fn()})}));
import {DeliveryInvoiceSyncStatus} from './DeliveryInvoiceSyncStatus';
describe('invoice delivery sync visibility',()=>{
 it('distinguishes queued invoice evidence from completed matching',()=>{
 query.value={data:{revision:2,processed_revision:1,last_success_at:null,last_error:null,result:null}};
 expect(renderToStaticMarkup(<DeliveryInvoiceSyncStatus/>)).toContain('المطابقة في انتظار التنفيذ');
 });
 it('does not display a failed read as successful zero counts',()=>{query.value={isError:true};const html=renderToStaticMarkup(<DeliveryInvoiceSyncStatus/>);expect(html).toContain('تعذر قراءة حالة المطابقة');expect(html).not.toContain('المطابقة مكتملة');});
 it('shows an evidence conflict as review instead of treating the source upload as rejected',()=>{
 query.value={data:{revision:2,processed_revision:1,last_error:'invoice_evidence_conflict_requires_review',result:null}};
 expect(renderToStaticMarkup(<DeliveryInvoiceSyncStatus/>)).toContain('يلزم مراجعتها قبل استبدال الدليل');
 });
 it('shows the confirmed match counts separately from source invoice counts',()=>{query.value={data:{revision:1,processed_revision:1,last_error:null,last_success_at:null,result:{invoices:100,orders:30,matched:20,pending:8,system_only:2,failed:2,human_decisions_preserved:0}}};const html=renderToStaticMarkup(<DeliveryInvoiceSyncStatus/>);expect(html).toContain('المطابقة مكتملة');expect(html).toContain('فواتير المصدر');expect(html).toContain('مطابق تلقائيًا');});
});
