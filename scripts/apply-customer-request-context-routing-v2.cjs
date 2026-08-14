const fs = require('fs');
const path = require('path');

function file(p) { return path.join(process.cwd(), p); }
function read(p) { return fs.readFileSync(file(p), 'utf8'); }
function write(p, value) { fs.writeFileSync(file(p), value); }
function replaceOnce(src, from, to, label) {
  if (!src.includes(from)) throw new Error(`anchor not found: ${label}`);
  return src.replace(from, to);
}

const MARKER = 'CUSTOMER_REQUEST_CONTEXT_ROUTING_V2';

// 1) Exact filters in the data layer.
{
  const p = 'src/lib/api/customerRequestsCommandCenter.ts';
  let src = read(p);
  if (!src.includes(MARKER)) {
    src = replaceOnce(src,
`  search?: string;
  quickFilter?: CustomerRequestQuickFilter;
}`,
`  search?: string;
  quickFilter?: CustomerRequestQuickFilter;
  requestId?: string;
  customerId?: string;
  customerCode?: string;
  customerPhone?: string;
  productCode?: string;
  medicineName?: string;
  registrar?: string; // ${MARKER}
}`,
'page options');

    src = replaceOnce(src,
`  let query = supabase.from('customer_requests').select('*', { count: 'exact' }).order('is_urgent', { ascending: false }).order('updated_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false, nullsFirst: false });

  if (options.status && options.status !== 'all') query = query.eq('status', options.status);`,
`  let query = supabase.from('customer_requests').select('*', { count: 'exact' }).order('is_urgent', { ascending: false }).order('updated_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false, nullsFirst: false });

  // Context filters are exact by design. They are used by deep-links from customer/product analytics
  // and must not degrade into a broad text search.
  if (options.requestId) query = query.eq('id', options.requestId);
  if (options.customerId) query = query.eq('customer_id', options.customerId);
  if (options.customerCode) query = query.eq('customer_code', options.customerCode);
  if (options.customerPhone) query = query.eq('customer_phone', options.customerPhone);
  if (options.productCode) query = query.eq('product_code', options.productCode);
  if (options.medicineName && !options.productCode) query = query.ilike('medicine_name', options.medicineName);
  if (options.registrar) {
    const registrar = safeSearch(options.registrar);
    query = query.or(\`doctor_name.ilike.\${registrar},created_by_name.ilike.\${registrar},source_assigned_employee.ilike.\${registrar}\`);
  }

  if (options.status && options.status !== 'all') query = query.eq('status', options.status);`,
'exact filters');
    write(p, src);
  }
}

// 2) Analytics actions send stable identifiers, not only display text.
{
  const p = 'src/components/customer-requests/CustomerRequestInsightsPanel.tsx';
  let src = read(p);
  if (!src.includes(MARKER)) {
    src = replaceOnce(src,
`type AnalyticsAction = {
  quickFilter?: 'all' | 'overdue' | 'unassigned';
  status?: string;
  assignee?: string;
  search?: string;
};`,
`type AnalyticsAction = {
  quickFilter?: 'all' | 'overdue' | 'unassigned';
  status?: string;
  assignee?: string;
  search?: string;
  branch?: string;
  customerCode?: string;
  customerPhone?: string;
  customerName?: string;
  productCode?: string;
  medicineName?: string; // ${MARKER}
};`,
'analytics action type');

    src = src.replace(
`onClick={() => onAction?.({ quickFilter: 'all' })} className="w-full rounded-2xl border border-slate-700 bg-slate-800/55 p-4 text-right transition hover:border-cyan-400/50">`,
`onClick={() => onAction?.({ quickFilter: 'all', branch: item.branch })} className="w-full rounded-2xl border border-slate-700 bg-slate-800/55 p-4 text-right transition hover:border-cyan-400/50">`);

    src = replaceOnce(src,
`onClick={() => onAction?.({ search: item.medicine_name })} className="w-full rounded-2xl border border-slate-700 bg-slate-800/55 p-3 text-right transition hover:border-cyan-400/50">`,
`onClick={() => onAction?.({ productCode: item.product_code, medicineName: item.medicine_name, branch: branch === 'all' ? undefined : branch, quickFilter: 'all' })} className="w-full rounded-2xl border border-slate-700 bg-slate-800/55 p-3 text-right transition hover:border-cyan-400/50">`,
'top product action');

    src = replaceOnce(src,
`onClick={() => onAction?.({ search: item.customer_code || item.customer_name })} className="flex w-full items-center gap-3 rounded-xl bg-slate-800/60 p-3 text-right hover:bg-slate-800">`,
`onClick={() => onAction?.({ customerCode: item.customer_code || undefined, customerPhone: item.customer_phone || undefined, customerName: item.customer_name, branch: branch === 'all' ? undefined : branch, quickFilter: 'all' })} className="flex w-full items-center gap-3 rounded-xl bg-slate-800/60 p-3 text-right hover:bg-slate-800">`,
'top customer action');

    write(p, src);
  }
}

// 3) Personal dashboard keeps its staff + branch context when opening requests.
{
  const p = 'src/components/customerService/CustomerServicePersonalDashboard.tsx';
  let src = read(p);
  if (!src.includes(MARKER)) {
    src = replaceOnce(src,
`<div className="rounded-3xl border p-5 cursor-pointer transition hover:border-sky-400/40" style={card} onClick={() => navigate('/customer-requests')}>`,
`<div className="rounded-3xl border p-5 cursor-pointer transition hover:border-sky-400/40" style={card} onClick={() => navigate(\`/customer-requests?workspace=requests&registrar=\${encodeURIComponent(staffName)}&branch=\${encodeURIComponent(branch)}&quick=all\`)} data-context-routing="${MARKER}">`,
'personal dashboard request link');
    write(p, src);
  }
}

// 4) CustomerRequests reads/writes route context and shows it visibly.
{
  const p = 'src/pages/CustomerRequests.tsx';
  let src = read(p);
  if (!src.includes(MARKER)) {
    src = replaceOnce(src,
`import { Link } from 'react-router-dom';`,
`import { Link, useSearchParams } from 'react-router-dom';`,
'router import');

    src = replaceOnce(src,
`export default function CustomerRequests() {
  const { user } = useAuth();`,
`export default function CustomerRequests() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();`,
'search params state');

    src = replaceOnce(src,
`  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');`,
`  const [branchFilter, setBranchFilter] = useState(() => searchParams.get('branch') || 'all');
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || 'all');`,
'initial branch/status');

    src = replaceOnce(src,
`  const [quickFilter, setQuickFilter] = useState<CustomerRequestQuickFilter>('attention');`,
`  const [quickFilter, setQuickFilter] = useState<CustomerRequestQuickFilter>(() => {
    const value = searchParams.get('quick') as CustomerRequestQuickFilter | null;
    return QUICK_FILTERS.some((item) => item.value === value) ? (value as CustomerRequestQuickFilter) : 'attention';
  });`,
'initial quick');

    src = replaceOnce(src,
`  const [workspaceTab, setWorkspaceTab] = useState<'overview' | 'requests' | 'followup' | 'analytics' | 'archive'>('overview');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false); // ADMIN_CUSTOMER_REQUESTS_TABS_V1`,
`  const [workspaceTab, setWorkspaceTab] = useState<'overview' | 'requests' | 'followup' | 'analytics' | 'archive'>(() => {
    const value = searchParams.get('workspace');
    return ['overview', 'requests', 'followup', 'analytics', 'archive'].includes(String(value)) ? value as 'overview' | 'requests' | 'followup' | 'analytics' | 'archive' : 'overview';
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false); // ADMIN_CUSTOMER_REQUESTS_TABS_V1
  const [contextRequestId, setContextRequestId] = useState(() => searchParams.get('requestId') || '');
  const [contextCustomerId, setContextCustomerId] = useState(() => searchParams.get('customerId') || '');
  const [contextCustomerCode, setContextCustomerCode] = useState(() => searchParams.get('customerCode') || '');
  const [contextCustomerPhone, setContextCustomerPhone] = useState(() => searchParams.get('customerPhone') || '');
  const [contextCustomerName, setContextCustomerName] = useState(() => searchParams.get('customerName') || '');
  const [contextProductCode, setContextProductCode] = useState(() => searchParams.get('productCode') || '');
  const [contextMedicineName, setContextMedicineName] = useState(() => searchParams.get('medicineName') || '');
  const [registrarFilter, setRegistrarFilter] = useState(() => searchParams.get('registrar') || ''); // ${MARKER}`,
'context state');

    src = replaceOnce(src,
`        getCustomerRequestsPage({ page, pageSize, status: statusFilter, branch: branchFilter, urgency: urgencyFilter, sourceSystem: sourceFilter, sourceChannel: channelFilter, assignee: assigneeFilter, dateFrom, dateTo, search, quickFilter }),`,
`        getCustomerRequestsPage({ page, pageSize, status: statusFilter, branch: branchFilter, urgency: urgencyFilter, sourceSystem: sourceFilter, sourceChannel: channelFilter, assignee: assigneeFilter, dateFrom, dateTo, search, quickFilter, requestId: contextRequestId, customerId: contextCustomerId, customerCode: contextCustomerCode, customerPhone: contextCustomerPhone, productCode: contextProductCode, medicineName: contextMedicineName, registrar: registrarFilter }),`,
'load options');

    src = replaceOnce(src,
`  }, [assigneeFilter, branchFilter, channelFilter, dateFrom, dateTo, page, pageSize, quickFilter, search, sourceFilter, statusFilter, urgencyFilter]);`,
`  }, [assigneeFilter, branchFilter, channelFilter, contextCustomerCode, contextCustomerId, contextCustomerPhone, contextMedicineName, contextProductCode, contextRequestId, dateFrom, dateTo, page, pageSize, quickFilter, registrarFilter, search, sourceFilter, statusFilter, urgencyFilter]);`,
'load deps');

    src = replaceOnce(src,
`  useEffect(() => setPage(1), [assigneeFilter, branchFilter, channelFilter, dateFrom, dateTo, quickFilter, search, sourceFilter, statusFilter, urgencyFilter]);`,
`  useEffect(() => setPage(1), [assigneeFilter, branchFilter, channelFilter, contextCustomerCode, contextCustomerId, contextCustomerPhone, contextMedicineName, contextProductCode, contextRequestId, dateFrom, dateTo, quickFilter, registrarFilter, search, sourceFilter, statusFilter, urgencyFilter]);`,
'page reset deps');

    const openDetailsAnchor = `  const openDetails = (request: CustomerRequest) => {
    setSelected(request);
    setShowDetails(true);
  };

  const applyAnalyticsAction =`;
    if (!src.includes(openDetailsAnchor)) throw new Error('open details anchor not found');
    src = src.replace(openDetailsAnchor, `  const openDetails = (request: CustomerRequest) => {
    setSelected(request);
    setShowDetails(true);
  };

  const clearRequestContext = () => {
    setContextRequestId('');
    setContextCustomerId('');
    setContextCustomerCode('');
    setContextCustomerPhone('');
    setContextCustomerName('');
    setContextProductCode('');
    setContextMedicineName('');
    setRegistrarFilter('');
  };

  useEffect(() => {
    if (!contextRequestId || !requests.length) return;
    const request = requests.find((item) => item.id === contextRequestId);
    if (request) openDetails(request);
  }, [contextRequestId, requests]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (workspaceTab !== 'overview') next.set('workspace', workspaceTab);
    if (branchFilter !== 'all') next.set('branch', branchFilter);
    if (statusFilter !== 'all') next.set('status', statusFilter);
    if (quickFilter !== 'attention') next.set('quick', quickFilter);
    if (search) next.set('search', search);
    if (assigneeFilter !== 'all') next.set('assignee', assigneeFilter);
    if (registrarFilter) next.set('registrar', registrarFilter);
    if (contextRequestId) next.set('requestId', contextRequestId);
    if (contextCustomerId) next.set('customerId', contextCustomerId);
    if (contextCustomerCode) next.set('customerCode', contextCustomerCode);
    if (contextCustomerPhone) next.set('customerPhone', contextCustomerPhone);
    if (contextCustomerName) next.set('customerName', contextCustomerName);
    if (contextProductCode) next.set('productCode', contextProductCode);
    if (contextMedicineName) next.set('medicineName', contextMedicineName);
    setSearchParams(next, { replace: true });
  }, [assigneeFilter, branchFilter, contextCustomerCode, contextCustomerId, contextCustomerName, contextCustomerPhone, contextMedicineName, contextProductCode, contextRequestId, quickFilter, registrarFilter, search, setSearchParams, statusFilter, workspaceTab]);

  const applyAnalyticsAction =`);

    src = replaceOnce(src,
`  const applyAnalyticsAction = (action: { quickFilter?: 'all' | 'overdue' | 'unassigned'; status?: string; assignee?: string; search?: string }) => {
    if (action.quickFilter) setQuickFilter(action.quickFilter);
    if (action.status) { setStatusFilter(action.status); setQuickFilter('all'); }
    if (action.assignee) { setAssigneeFilter(action.assignee); setQuickFilter('all'); }
    if (action.search) { setSearch(action.search); setQuickFilter('all'); }
    setWorkspaceTab('requests');
    setPage(1);
    window.setTimeout(() => document.getElementById('customer-request-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };`,
`  const applyAnalyticsAction = (action: { quickFilter?: 'all' | 'overdue' | 'unassigned'; status?: string; assignee?: string; search?: string; branch?: string; customerCode?: string; customerPhone?: string; customerName?: string; productCode?: string; medicineName?: string }) => {
    const hasEntityContext = Boolean(action.customerCode || action.customerPhone || action.customerName || action.productCode || action.medicineName);
    if (hasEntityContext) {
      clearRequestContext();
      setSearch('');
      setContextCustomerCode(action.customerCode || '');
      setContextCustomerPhone(action.customerPhone || '');
      setContextCustomerName(action.customerName || '');
      setContextProductCode(action.productCode || '');
      setContextMedicineName(action.medicineName || '');
    }
    if (action.branch) setBranchFilter(action.branch);
    if (action.quickFilter) setQuickFilter(action.quickFilter);
    if (action.status) { setStatusFilter(action.status); setQuickFilter('all'); }
    if (action.assignee) { clearRequestContext(); setAssigneeFilter(action.assignee); setQuickFilter('all'); }
    if (action.search) { clearRequestContext(); setSearch(action.search); setQuickFilter('all'); }
    setWorkspaceTab('requests');
    setPage(1);
    window.setTimeout(() => document.getElementById('customer-request-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };`,
'analytics handler');

    src = replaceOnce(src,
`  const clearFilters = () => {
    setSearch(''); setBranchFilter('all'); setStatusFilter('all'); setUrgencyFilter('all'); setSourceFilter('all'); setChannelFilter('all'); setAssigneeFilter('all'); setDateFrom(''); setDateTo(''); setQuickFilter('all'); setPage(1);
  };`,
`  const clearFilters = () => {
    setSearch(''); setBranchFilter('all'); setStatusFilter('all'); setUrgencyFilter('all'); setSourceFilter('all'); setChannelFilter('all'); setAssigneeFilter('all'); setDateFrom(''); setDateTo(''); setQuickFilter('all'); clearRequestContext(); setPage(1);
  };`,
'clear filters');

    src = replaceOnce(src,
`        const result = await getCustomerRequestsPage({ page: exportPage, pageSize: 100, status: statusFilter, branch: branchFilter, urgency: urgencyFilter, sourceSystem: sourceFilter, sourceChannel: channelFilter, assignee: assigneeFilter, dateFrom, dateTo, search, quickFilter });`,
`        const result = await getCustomerRequestsPage({ page: exportPage, pageSize: 100, status: statusFilter, branch: branchFilter, urgency: urgencyFilter, sourceSystem: sourceFilter, sourceChannel: channelFilter, assignee: assigneeFilter, dateFrom, dateTo, search, quickFilter, requestId: contextRequestId, customerId: contextCustomerId, customerCode: contextCustomerCode, customerPhone: contextCustomerPhone, productCode: contextProductCode, medicineName: contextMedicineName, registrar: registrarFilter });`,
'export options');

    const filterBox = `          <div className="rounded-2xl border border-slate-700 bg-slate-950/45 p-3">`;
    const contextBanner = `          {(contextCustomerCode || contextCustomerPhone || contextCustomerName || contextProductCode || contextMedicineName || registrarFilter || contextRequestId) && (
            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-500/[0.08] p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-black text-cyan-200">عرض مرتبط بالسياق — الفلتر دقيق وليس بحثًا عامًا</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                    {(contextCustomerName || contextCustomerCode || contextCustomerPhone) && <span className="rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-white">العميل: {contextCustomerName || '—'}{contextCustomerCode ? \` · كود \${contextCustomerCode}\` : ''}{contextCustomerPhone ? \` · \${contextCustomerPhone}\` : ''}</span>}
                    {(contextMedicineName || contextProductCode) && <span className="rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-white">الصنف: {contextMedicineName || '—'}{contextProductCode ? \` · كود \${contextProductCode}\` : ''}</span>}
                    {registrarFilter && <span className="rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-white">مسجل الطلبات: {registrarFilter}</span>}
                    {branchFilter !== 'all' && <span className="rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-white">الفرع: {branchFilter}</span>}
                  </div>
                </div>
                <button type="button" onClick={() => { clearRequestContext(); setSearch(''); setQuickFilter('all'); setStatusFilter('all'); setPage(1); }} className="h-9 shrink-0 rounded-xl border border-cyan-400/25 bg-slate-950 px-3 text-xs font-black text-cyan-100 hover:bg-slate-900">إلغاء سياق العميل/الصنف</button>
              </div>
            </div>
          )}

${filterBox}`;
    src = replaceOnce(src, filterBox, contextBanner, 'context banner');

    src = replaceOnce(src,
`              {(search || branchFilter !== 'all' || statusFilter !== 'all' || urgencyFilter !== 'all' || sourceFilter !== 'all' || channelFilter !== 'all' || assigneeFilter !== 'all' || dateFrom || dateTo) && (`,
`              {(search || branchFilter !== 'all' || statusFilter !== 'all' || urgencyFilter !== 'all' || sourceFilter !== 'all' || channelFilter !== 'all' || assigneeFilter !== 'all' || registrarFilter || contextCustomerCode || contextCustomerPhone || contextProductCode || contextMedicineName || contextRequestId || dateFrom || dateTo) && (`,
'active filter visibility');

    write(p, src);
  }
}

console.log('customer request context routing v2 applied');
