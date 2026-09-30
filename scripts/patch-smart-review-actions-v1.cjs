const fs = require('fs');
const path = require('path');

function patchFile(rel, mutate) {
  const file = path.join(process.cwd(), rel);
  let src = fs.readFileSync(file, 'utf8');
  const next = mutate(src);
  if (next !== src) fs.writeFileSync(file, next);
}
function addAfter(src, anchor, value, label) {
  if (src.includes(value.trim())) return src;
  if (!src.includes(anchor)) throw new Error(`[smart-review-actions] ${label} anchor not found`);
  return src.replace(anchor, `${anchor}\n${value}`);
}
function replaceOnce(src, from, to, label) {
  if (src.includes(to)) return src;
  if (!src.includes(from)) throw new Error(`[smart-review-actions] ${label} anchor not found`);
  return src.replace(from, to);
}

patchFile('src/pages/SmartConversationReviewRebuild.tsx', (source) => {
  let src = source;
  src = addAfter(src, `import { useMemo, useState } from 'react';`, `import { useNavigate } from 'react-router-dom';`, 'navigate import');
  src = addAfter(src, `import type { SmartStaffRole } from '@/lib/whatsappSmartReviewOwnership';`, `import { buildSmartReviewActionPlan, writeSmartCustomerRequestTransfer, writeSmartFollowupTransfer } from '@/lib/whatsappSmartReviewActions';`, 'action imports');
  const component = `export default function SmartConversationReviewRebuild() {`;
  if (!src.includes('  const navigate = useNavigate();')) src = replaceOnce(src, component, `${component}\n  const navigate = useNavigate();`, 'navigate state');

  const visibleAnchor = `  const visibleStaff = activeReview?.staffSummaries || [];`;
  const actionState = `  const actionPlan = useMemo(() => buildSmartReviewActionPlan({\n    intelligence: pipeline?.intelligence || null,\n    staffName: selectedStaff?.staffName || null,\n    fallbackCustomerName: selectedSession?.customerName || null,\n  }), [pipeline?.intelligence, selectedStaff?.staffName, selectedSession?.customerName]);`;
  if (!src.includes('const actionPlan = useMemo')) src = addAfter(src, visibleAnchor, actionState, 'action plan');

  const onFileAnchor = `  async function onFile(file?: File) {`;
  if (!src.includes('function openDetectedCustomerRequest()')) {
    const handlers = `  function openDetectedCustomerRequest() {\n    if (!actionPlan.customerRequest) return;\n    writeSmartCustomerRequestTransfer(actionPlan.customerRequest);\n    navigate('/customer-requests?createFromSmart=1');\n  }\n\n  function openDetectedFollowup() {\n    if (!actionPlan.followup) return;\n    writeSmartFollowupTransfer(actionPlan.followup);\n    navigate('/customer-service?quickFollowup=1');\n  }\n\n`;
    if (!src.includes(onFileAnchor)) throw new Error('[smart-review-actions] onFile anchor not found');
    src = src.replace(onFileAnchor, `${handlers}${onFileAnchor}`);
  }

  const oldPanel = `<SmartConversationIntelligencePanel conversation={pipeline.conversationIntelligence} staff={pipeline.intelligence} />`;
  const newPanel = `<SmartConversationIntelligencePanel conversation={pipeline.conversationIntelligence} staff={pipeline.intelligence} onCreateRequest={actionPlan.customerRequest ? openDetectedCustomerRequest : undefined} onCreateFollowup={actionPlan.followup ? openDetectedFollowup : undefined} />`;
  src = replaceOnce(src, oldPanel, newPanel, 'panel actions');
  return src;
});

patchFile('src/components/reviews/SmartConversationIntelligencePanel.tsx', (source) => {
  let src = source;
  const oldSignature = `export default function SmartConversationIntelligencePanel({ conversation, staff }: { conversation: SmartDeepConversationAnalysis | null; staff: SmartDeepConversationAnalysis | null }) {`;
  const newSignature = `export default function SmartConversationIntelligencePanel({ conversation, staff, onCreateRequest, onCreateFollowup }: { conversation: SmartDeepConversationAnalysis | null; staff: SmartDeepConversationAnalysis | null; onCreateRequest?: () => void; onCreateFollowup?: () => void }) {`;
  src = replaceOnce(src, oldSignature, newSignature, 'panel signature');
  if (!src.includes('تأكيد وتسجيل طلب العميل')) {
    const closing = `    </div>\n  </section>;\n}`;
    const actions = `    </div>\n    {(onCreateRequest || onCreateFollowup) ? <div className="flex flex-wrap gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3">\n      {onCreateRequest ? <button type="button" onClick={onCreateRequest} className="rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-black text-slate-950">تأكيد وتسجيل طلب العميل</button> : null}\n      {onCreateFollowup ? <button type="button" onClick={onCreateFollowup} className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-black text-emerald-100">فتح متابعة للعميل</button> : null}\n      <div className="w-full text-xs leading-6 text-slate-400">التحليل لا يسجل أي طلب أو متابعة تلقائيًا. يفتح النموذج الرسمي بالبيانات المستخرجة، ويجب تأكيد العميل والصنف قبل الحفظ.</div>\n    </div> : null}\n  </section>;\n}`;
    src = replaceOnce(src, closing, actions, 'panel action buttons');
  }
  return src;
});

patchFile('src/components/CustomerSmartSearch.tsx', (source) => {
  let src = source;
  src = replaceOnce(src, `  allowCreate?: boolean;\n};`, `  allowCreate?: boolean;\n  initialQuery?: string;\n};`, 'customer initial query type');
  src = replaceOnce(src, `  allowCreate = true,\n}: Props) {\n  const [query, setQuery] = useState('');`, `  allowCreate = true,\n  initialQuery = '',\n}: Props) {\n  const [query, setQuery] = useState(initialQuery);`, 'customer initial query state');
  return src;
});

patchFile('src/components/ProductSmartSearch.tsx', (source) => {
  let src = source;
  src = replaceOnce(src, `  disabled,\n}: {\n  value: CatalogProduct | null;\n  onSelect: (product: CatalogProduct | null) => void;\n  disabled?: boolean;\n}) {\n  const [query, setQuery] = useState('');`, `  disabled,\n  initialQuery = '',\n}: {\n  value: CatalogProduct | null;\n  onSelect: (product: CatalogProduct | null) => void;\n  disabled?: boolean;\n  initialQuery?: string;\n}) {\n  const [query, setQuery] = useState(initialQuery);`, 'product initial query');
  return src;
});

patchFile('src/features/customer-requests/workspace/CanonicalCreateRequestDialog.tsx', (source) => {
  let src = source;
  src = addAfter(src, `import type { CustomerRequest } from '@/lib/api/customerRequests';`, `import type { SmartCustomerRequestActionProposal } from '@/lib/whatsappSmartReviewActions';`, 'dialog action type');
  const oldProps = `export default function CanonicalCreateRequestDialog({\n  onClose,\n  onCreated,\n}: {\n  onClose: () => void;\n  onCreated: (request: CustomerRequest) => void | Promise<void>;\n}) {`;
  const newProps = `export default function CanonicalCreateRequestDialog({\n  onClose,\n  onCreated,\n  prefill = null,\n}: {\n  onClose: () => void;\n  onCreated: (request: CustomerRequest) => void | Promise<void>;\n  prefill?: SmartCustomerRequestActionProposal | null;\n}) {`;
  src = replaceOnce(src, oldProps, newProps, 'dialog props');
  src = replaceOnce(src, `  const [quantity, setQuantity] = useState(1);`, `  const [quantity, setQuantity] = useState(prefill?.quantity || 1);`, 'quantity prefill');
  src = replaceOnce(src, `  const [channel, setChannel] = useState('داخل الصيدلية');`, `  const [channel, setChannel] = useState(prefill ? 'واتساب' : 'داخل الصيدلية');`, 'channel prefill');
  src = replaceOnce(src, `  const [notes, setNotes] = useState('');`, `  const [notes, setNotes] = useState(prefill ? [\n    'مستخرج من المراجعة الذكية — يحتاج تأكيد قبل الحفظ',\n    prefill.productName ? \`الصنف المستخرج: \${prefill.productName}\` : '',\n    prefill.concentration ? \`التركيز: \${prefill.concentration}\` : '',\n    prefill.evidenceMessageIds.length ? \`رسائل الدليل: \${prefill.evidenceMessageIds.join(', ')}\` : '',\n  ].filter(Boolean).join(' | ') : '');`, 'notes prefill');

  const selectedDoctorAnchor = `  const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId) || null;`;
  if (!src.includes('prefill?.staffName && !doctorId')) {
    const doctorEffect = `  useEffect(() => {\n    if (!prefill?.staffName || doctorId || !doctors.length) return;\n    const normalize = (value: string) => value.trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\\s+/g, ' ');\n    const target = normalize(prefill.staffName);\n    const match = doctors.find((doctor) => { const name = normalize(doctor.name); return name === target || name.includes(target) || target.includes(name); });\n    if (match) setDoctorId(match.id);\n  }, [prefill?.staffName, doctorId, doctors]);\n`;
    src = addAfter(src, selectedDoctorAnchor, doctorEffect, 'doctor prefill effect');
  }
  src = replaceOnce(src, `<CustomerSmartSearch value={customer} onSelect={setCustomer} placeholder="اسم العميل أو الكود أو الهاتف" disabled={saving} allowCreate />`, `<CustomerSmartSearch value={customer} onSelect={setCustomer} placeholder="اسم العميل أو الكود أو الهاتف" initialQuery={prefill?.customerCode || prefill?.customerPhone || prefill?.customerName || ''} disabled={saving} allowCreate />`, 'customer search prefill');
  src = replaceOnce(src, `<ProductSmartSearch value={product} onSelect={setProduct} disabled={saving} />`, `<ProductSmartSearch value={product} onSelect={setProduct} initialQuery={prefill?.productName || ''} disabled={saving} />`, 'product search prefill');
  return src;
});

patchFile('src/features/customer-requests/workspace/CustomerRequestsWorkspace.tsx', (source) => {
  let src = source;
  src = addAfter(src, `import type { CustomerRequest } from '@/lib/api/customerRequests';`, `import { clearSmartCustomerRequestTransfer, readSmartCustomerRequestTransfer, type SmartCustomerRequestActionProposal } from '@/lib/whatsappSmartReviewActions';`, 'workspace transfer import');
  src = replaceOnce(src, `  const [createOpen, setCreateOpen] = useState(false);`, `  const [createOpen, setCreateOpen] = useState(false);\n  const [smartPrefill, setSmartPrefill] = useState<SmartCustomerRequestActionProposal | null>(null);`, 'workspace prefill state');
  if (!src.includes("searchParams.get('createFromSmart') === '1'")) {
    const effectAnchor = `  const [productMetrics, setProductMetrics] = useState<Record<string, CustomerRequestProductMetric>>({});`;
    const effect = `\n  useEffect(() => {\n    if (!canManageRequests || searchParams.get('createFromSmart') !== '1') return;\n    const proposal = readSmartCustomerRequestTransfer();\n    if (!proposal) return;\n    setSmartPrefill(proposal);\n    setCreateOpen(true);\n  }, [canManageRequests, searchParams]);`;
    src = addAfter(src, effectAnchor, effect, 'workspace prefill effect');
  }
  const oldDialog = `{canManageRequests && createOpen ? <CanonicalCreateRequestDialog onClose={() => setCreateOpen(false)} onCreated={onCreated} /> : null}`;
  const newDialog = `{canManageRequests && createOpen ? <CanonicalCreateRequestDialog prefill={smartPrefill} onClose={() => { setCreateOpen(false); setSmartPrefill(null); clearSmartCustomerRequestTransfer(); }} onCreated={async (request) => { clearSmartCustomerRequestTransfer(); setSmartPrefill(null); await onCreated(request); }} /> : null}`;
  src = replaceOnce(src, oldDialog, newDialog, 'workspace dialog prefill');
  return src;
});

console.log('[smart-review-actions] safe confirm-before-write customer request and followup handoffs wired');
