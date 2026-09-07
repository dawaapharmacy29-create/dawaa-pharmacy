import { Filter, Loader2, Search, X } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import type { PageTab } from '../types';

type Props = {
  activeTab: PageTab;
  fromDate: string;
  toDate: string;
  employeeFilter: string;
  reviewerFilter: string;
  branchFilter: string;
  recordSearch: string;
  loadingSearch: boolean;
  searchError: boolean;
  employeeOptions: string[];
  reviewerOptions: string[];
  branchOptions: string[];
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onEmployeeChange: (value: string) => void;
  onReviewerChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onClearFilters: () => void;
};

export function FiltersPanel({
  activeTab,
  fromDate,
  toDate,
  employeeFilter,
  reviewerFilter,
  branchFilter,
  recordSearch,
  loadingSearch,
  searchError,
  employeeOptions,
  reviewerOptions,
  branchOptions,
  onFromDateChange,
  onToDateChange,
  onEmployeeChange,
  onReviewerChange,
  onBranchChange,
  onSearchChange,
  onClearFilters,
}: Props) {
  const hasFilters = Boolean(fromDate || toDate || employeeFilter || reviewerFilter || branchFilter);

  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}><Filter size={16} /> الفلاتر</div>
        {hasFilters ? (
          <button type="button" onClick={onClearFilters} className="flex items-center gap-1 text-xs font-black" style={{ color: 'var(--dawaa-status-danger-text)' }}><X size={14} /> مسح الفلاتر</button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
          <span>من تاريخ</span><input type="date" className="input-dark w-full text-sm" value={fromDate} onChange={(event) => onFromDateChange(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
          <span>إلى تاريخ</span><input type="date" className="input-dark w-full text-sm" value={toDate} onChange={(event) => onToDateChange(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
          <span>الموظف</span>
          <select className="input-dark w-full text-sm" value={employeeFilter} onChange={(event) => onEmployeeChange(event.target.value)}>
            <option value="">كل الموظفين</option>
            {employeeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        {activeTab === 'history' || activeTab === 'reports' ? (
          <label className="space-y-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
            <span>المراجع</span>
            <select className="input-dark w-full text-sm" value={reviewerFilter} onChange={(event) => onReviewerChange(event.target.value)}>
              <option value="">كل المراجعين</option>
              {reviewerOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        ) : <div className="hidden lg:block" />}
        <label className="space-y-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
          <span>الفرع</span>
          <select className="input-dark w-full text-sm" value={branchFilter} onChange={(event) => onBranchChange(event.target.value)}>
            <option value="">كل الفروع</option>
            {branchOptions.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          </select>
        </label>
      </div>

      {activeTab === 'invoices' || activeTab === 'history' ? (
        <div className="relative mt-3">
          <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--dawaa-theme-muted)' }} />
          <input type="search" className="input-dark w-full pr-9 text-sm" placeholder="ابحث باسم الموظف أو رقم الفاتورة أو Base44 ID..." value={recordSearch} onChange={(event) => onSearchChange(event.target.value)} />
          {loadingSearch ? (
            <Loader2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin" style={{ color: 'var(--dawaa-theme-primary)' }} />
          ) : recordSearch ? (
            <button type="button" onClick={() => onSearchChange('')} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--dawaa-theme-muted)' }} aria-label="مسح البحث"><X size={15} /></button>
          ) : null}
        </div>
      ) : null}

      {searchError ? <p className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-status-warning-text)' }}>تعذّر البحث التاريخي مؤقتًا؛ المعروض حاليًا من البيانات المحملة فقط.</p> : null}
    </Panel>
  );
}
