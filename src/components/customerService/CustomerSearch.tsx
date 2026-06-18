import { useState, useEffect, useMemo } from "react";
import { Search, User, Phone, Building2, X } from "lucide-react";
import { getCustomers, type GetCustomersOptions } from "@/lib/api/customers";
import { cleanEgyptianPhone, displayEgyptianPhone } from "@/lib/whatsapp";
import { normalizeBranchName } from "@/lib/branch";
import { normalizePhone, normalizeArabicText } from "@/lib/customerSearch";
import type { CustomerMetric as Customer } from "@/lib/api/customers";
import { toast } from "sonner";

interface CustomerSearchProps {
  onSelect: (customer: Customer) => void;
  onUnregistered?: () => void;
  branch?: string;
  placeholder?: string;
}

interface SearchResult {
  customer: Customer;
  matchType: "code" | "name" | "phone" | "whatsapp";
}

export default function CustomerSearch({ onSelect, onUnregistered, branch, placeholder = "ابحث باسم العميل، الكود، الهاتف..." }: CustomerSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isUnregisteredMode, setIsUnregisteredMode] = useState(false);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const options: GetCustomersOptions = {
          search: query,
          limit: 20,
          branch,
        };
        const { customers } = await getCustomers(options);
        
        // Determine match type for each result
        const searchResults: SearchResult[] = customers.map(customer => {
          const normalizedQuery = normalizeArabicText(query.replace(/\*/g, ""));
          const code = normalizeArabicText(String(customer.customer_code || ""));
          const name = normalizeArabicText(String(customer.name || ""));
          const phone = normalizePhone(customer.phone || customer.customer_phone || "");
          const whatsapp = normalizePhone((customer as any).whatsapp_phone || "");
          const phoneQuery = normalizePhone(query);

          let matchType: SearchResult["matchType"] = "name";
          if (code === normalizedQuery || code.startsWith(normalizedQuery)) matchType = "code";
          else if (name.includes(normalizedQuery)) matchType = "name";
          else if (phone.includes(phoneQuery) || phone.startsWith(phoneQuery)) matchType = "phone";
          else if (whatsapp.includes(phoneQuery) || whatsapp.startsWith(phoneQuery)) matchType = "whatsapp";

          (customer as any).displayPhone = displayEgyptianPhone(phone || whatsapp || "");
          return { customer, matchType };
        });

        setResults(searchResults);
        setShowResults(true);
      } catch (error) {
        console.error("Search error:", error);
        toast.error("حدث خطأ في البحث");
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, branch]);

  const handleSelect = (result: SearchResult) => {
    onSelect(result.customer);
    setQuery("");
    setResults([]);
    setShowResults(false);
  };

  const handleUnregistered = () => {
    setIsUnregisteredMode(true);
    onUnregistered?.();
    setQuery("");
    setResults([]);
    setShowResults(false);
  };

  const matchTypeLabel = (type: SearchResult["matchType"]) => {
    const labels = {
      code: "كود",
      name: "اسم",
      phone: "هاتف",
      whatsapp: "واتساب",
    };
    return labels[type];
  };

  const matchTypeColor = (type: SearchResult["matchType"]) => {
    const colors = {
      code: "bg-purple-500/20 text-purple-300",
      name: "bg-blue-500/20 text-blue-300",
      phone: "bg-green-500/20 text-green-300",
      whatsapp: "bg-teal-500/20 text-teal-300",
    };
    return colors[type];
  };

  if (isUnregisteredMode) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm text-slate-300">اسم العميل (غير مسجل)</label>
          <button
            onClick={() => setIsUnregisteredMode(false)}
            className="text-xs text-teal-400 hover:text-teal-300"
          >
            بحث في قاعدة العملاء
          </button>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="أدخل اسم العميل يدويًا"
          className="input-dark"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={18} className="absolute right-3 top-3 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setShowResults(true)}
          placeholder={placeholder}
          className="input-dark pr-10"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              setShowResults(false);
            }}
            className="absolute left-3 top-3 text-slate-400 hover:text-white"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && (query || results.length > 0) && (
        <div className="absolute z-50 w-full bg-[#1B2B4B] border border-[#2d4063] rounded-xl shadow-2xl max-h-96 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-slate-400">
              جاري البحث...
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 space-y-2">
              <div className="text-center text-slate-400 text-sm">
                لم يتم العثور على نتائج
              </div>
              <button
                onClick={handleUnregistered}
                className="w-full btn-secondary text-sm flex items-center justify-center gap-2"
              >
                <User size={16} />
                عميل غير مسجل
              </button>
            </div>
          ) : (
            <>
              <div className="p-2 border-b border-white/10">
                <button
                  onClick={handleUnregistered}
                  className="w-full text-left px-3 py-2 text-sm text-teal-400 hover:bg-teal-500/10 rounded-lg flex items-center gap-2"
                >
                  <User size={16} />
                  عميل غير مسجل
                </button>
              </div>
              {results.map((result, index) => (
                <button
                  key={`${result.customer.id}-${index}`}
                  onClick={() => handleSelect(result)}
                  className="w-full text-right p-3 hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium truncate">
                          {result.customer.name}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${matchTypeColor(result.matchType)}`}>
                          {matchTypeLabel(result.matchType)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1 text-xs text-slate-400">
                        {result.customer.customer_code && (
                          <span>كود: {result.customer.customer_code}</span>
                        )}
                        {result.customer.phone && (
                          <span className="flex items-center gap-1">
                            <Phone size={12} />
                            {displayEgyptianPhone(result.customer.phone)}
                          </span>
                        )}
                        {result.customer.branch && (
                          <span className="flex items-center gap-1">
                            <Building2 size={12} />
                            {normalizeBranchName(result.customer.branch)}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1 text-xs">
                        <span className="text-purple-300">
                          {result.customer.type || "غير محدد"}
                        </span>
                        {result.customer.last_purchase && (
                          <span className="text-slate-400">
                            آخر شراء: {result.customer.last_purchase.slice(0, 10)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-left">
                      {result.customer.avg_monthly && (
                        <div className="text-teal-300 text-sm font-medium">
                          {Math.round(result.customer.avg_monthly)} ج
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
