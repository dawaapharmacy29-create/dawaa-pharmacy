import { FormEvent, useState } from 'react';
import { Loader2, Plus, Search, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import {
  createCustomerFromSearch,
  searchCustomers,
  type CustomerSearchResult,
} from '@/lib/customerSearch';

type Props = {
  value?: CustomerSearchResult | null;
  onSelect: (customer: CustomerSearchResult) => void;
  placeholder?: string;
  branchFilter?: string;
  disabled?: boolean;
  allowCreate?: boolean;
};

export default function CustomerSmartSearch({
  value,
  onSelect,
  placeholder = 'ابحث باسم العميل أو الكود أو الهاتف واستخدم * عند الحاجة',
  branchFilter,
  disabled,
  allowCreate = true,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', code: '' });

  const runSearch = async () => {
    if (!query.trim()) return toast.error('اكتب اسم العميل أو الكود أو رقم الهاتف أولا');
    setLoading(true);
    try {
      const data = await searchCustomers(query);
      setResults(
        branchFilter && branchFilter !== 'الكل'
          ? data.filter((item) => !item.branch || item.branch === branchFilter)
          : data
      );
      if (!data.length) setShowCreate(true);
    } catch (error) {
      toast.error(`تعذر البحث عن العميل: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const addCustomer = async (event: FormEvent) => {
    event.preventDefault();
    if (!newCustomer.name.trim() || !newCustomer.phone.trim())
      return toast.error('اسم العميل ورقم الهاتف مطلوبان');
    setLoading(true);
    try {
      const created = await createCustomerFromSearch({ ...newCustomer, branch: branchFilter });
      onSelect(created);
      setShowCreate(false);
      setResults([created]);
      toast.success('تم إضافة العميل واختياره');
    } catch (error) {
      toast.error(`تعذر إضافة العميل: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            className="input-dark pr-9"
            value={query}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void runSearch();
              }
            }}
          />
        </div>
        <button
          type="button"
          className="btn-secondary px-4"
          disabled={disabled || loading}
          onClick={runSearch}
          aria-label="بحث"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
        </button>
        {allowCreate && (
          <button
            type="button"
            className="btn-secondary px-4"
            disabled={disabled}
            onClick={() => setShowCreate((current) => !current)}
            aria-label="إضافة عميل"
          >
            <Plus size={16} />
          </button>
        )}
      </div>

      {value && (
        <div className="rounded-xl border border-teal-400/30 bg-teal-500/10 p-3 text-sm text-teal-50">
          <div className="font-black">{value.name}</div>
          <div className="mt-1 text-xs text-teal-100/80">
            كود: {value.code || 'بدون كود'} · هاتف: {value.phone || 'بدون رقم'} ·{' '}
            {value.branch || 'فرع غير محدد'}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="grid max-h-64 gap-2 overflow-y-auto rounded-xl border border-[#2d4063] bg-[#10213a] p-2">
          {results.map((customer) => (
            <button
              key={`${customer.id}-${customer.code}-${customer.phone}`}
              type="button"
              onClick={() => {
                onSelect(customer);
                setResults([]);
                setShowCreate(false);
                setQuery('');
              }}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-right transition hover:border-teal-400/40 hover:bg-teal-500/10"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-500/15 text-teal-300">
                <UserRound size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-white">{customer.name}</span>
                <span className="block truncate text-xs text-slate-400">
                  كود: {customer.code || 'بدون كود'} · هاتف: {customer.phone || 'بدون رقم'} ·{' '}
                  {customer.branch || 'فرع غير محدد'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {showCreate && allowCreate && (
        <form
          onSubmit={addCustomer}
          className="grid gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 md:grid-cols-3"
        >
          <input
            className="input-dark"
            value={newCustomer.name}
            onChange={(event) =>
              setNewCustomer((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="اسم العميل الجديد"
          />
          <input
            className="input-dark"
            value={newCustomer.phone}
            onChange={(event) =>
              setNewCustomer((current) => ({ ...current, phone: event.target.value }))
            }
            placeholder="رقم الهاتف"
          />
          <div className="flex gap-2">
            <input
              className="input-dark"
              value={newCustomer.code}
              onChange={(event) =>
                setNewCustomer((current) => ({ ...current, code: event.target.value }))
              }
              placeholder="الكود إن وجد"
            />
            <button className="btn-primary whitespace-nowrap px-4" disabled={loading}>
              إضافة
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export type { CustomerSearchResult };
