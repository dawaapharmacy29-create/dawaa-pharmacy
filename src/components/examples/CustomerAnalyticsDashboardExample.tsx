import React, { useEffect, useState, useMemo } from 'react';
import { useLocalCache } from '@/hooks/useLocalCache';
import { useDataProcessor } from '@/hooks/useDataProcessor';
import { useMemoizedArray } from '@/hooks/useMemoizedSelector';

/**
 * Real-world example: Optimized Customer Analytics Dashboard
 * 
 * Performance improvements:
 * - useLocalCache: Caches API responses (5 min TTL)
 * - useDataProcessor: Offloads filtering/aggregation to Web Worker
 * - useMemoizedArray: Prevents downstream re-renders
 * - React.memo: Memoizes table rows
 */

interface SalesRecord {
  id: string;
  customer_id: string;
  customer_name: string;
  amount: number;
  date: string;
  branch: string;
  status: 'completed' | 'pending' | 'cancelled';
}

// Memoized table row to prevent re-renders
const SalesRow = React.memo(
  ({ record, onSelect }: { record: SalesRecord; onSelect: (id: string) => void }) => (
    <tr 
      onClick={() => onSelect(record.id)}
      className="hover:bg-gray-100 cursor-pointer"
    >
      <td className="px-4 py-2">{record.customer_name}</td>
      <td className="px-4 py-2">{record.amount.toLocaleString('ar-EG')}</td>
      <td className="px-4 py-2">{record.branch}</td>
      <td className="px-4 py-2">{record.status}</td>
      <td className="px-4 py-2">{new Date(record.date).toLocaleDateString('ar-EG')}</td>
    </tr>
  ),
  (prevProps, nextProps) => 
    prevProps.record.id === nextProps.record.id &&
    prevProps.onSelect === nextProps.onSelect
);

export function CustomerAnalyticsDashboard() {
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [minAmount, setMinAmount] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // 1. Cache API responses with 5-minute TTL
  const { data: rawSales, loading: loadingSales } = useLocalCache(
    'customer-sales-analytics',
    async () => {
      const response = await fetch('/api/sales');
      return response.json() as Promise<SalesRecord[]>;
    },
    { ttlMs: 5 * 60 * 1000 } // 5 minutes
  );

  // 2. Offload heavy filtering/sorting to Web Worker
  const { filter, sort, aggregate, loading: processingData } = useDataProcessor();
  const [filteredSales, setFilteredSales] = useState<SalesRecord[]>([]);

  // 3. Build filter conditions
  useEffect(() => {
    if (!rawSales) return;

    const conditions = [
      // Branch filter
      ...(selectedBranch !== 'all' 
        ? [{ field: 'branch', op: 'eq' as const, value: selectedBranch }]
        : []
      ),
      // Amount filter
      ...(minAmount > 0
        ? [{ field: 'amount', op: 'gte' as const, value: minAmount }]
        : []
      ),
      // Status filter
      ...(statusFilter !== 'all'
        ? [{ field: 'status', op: 'eq' as const, value: statusFilter }]
        : []
      ),
    ];

    (async () => {
      const filtered = await filter(rawSales as unknown as Record<string, unknown>[], conditions);
      const sorted = await sort(filtered, [
        { field: 'date', ascending: false },
        { field: 'amount', ascending: false },
      ]);
      setFilteredSales(sorted as unknown as SalesRecord[]);
    })();
  }, [rawSales, selectedBranch, minAmount, statusFilter, filter, sort]);

  // 4. Memoize the filtered array to prevent downstream re-renders
  const memoizedSales = useMemoizedArray(filteredSales, [filteredSales.length]);

  // 5. Calculate aggregates in Web Worker
  const [stats, setStats] = useState({
    totalAmount: 0,
    avgAmount: 0,
    count: 0,
  });

  useEffect(() => {
    if (!rawSales) return;

    (async () => {
      const [total, avg] = await Promise.all([
        aggregate(memoizedSales as unknown as Record<string, unknown>[], 'amount', 'sum'),
        aggregate(memoizedSales as unknown as Record<string, unknown>[], 'amount', 'avg'),
      ]);

      setStats({
        totalAmount: Number(total),
        avgAmount: Number(avg),
        count: memoizedSales.length,
      });
    })();
  }, [aggregate, memoizedSales]);

  // 6. Get unique branches for filter
  const branches = useMemo(
    () => [...new Set(rawSales?.map(s => s.branch) || [])],
    [rawSales]
  );

  const isLoading = loadingSales || processingData;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">تحليلات المبيعات</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-sm text-gray-600">إجمالي المبيعات</div>
          <div className="text-2xl font-bold text-blue-600">
            {stats.totalAmount.toLocaleString('ar-EG')}
          </div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="text-sm text-gray-600">المتوسط</div>
          <div className="text-2xl font-bold text-green-600">
            {stats.avgAmount.toLocaleString('ar-EG', { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg">
          <div className="text-sm text-gray-600">عدد الفواتير</div>
          <div className="text-2xl font-bold text-purple-600">
            {stats.count.toLocaleString('ar-EG')}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <h2 className="text-lg font-semibold mb-4">الفلاتر</h2>
        <div className="grid grid-cols-3 gap-4">
          {/* Branch Filter */}
          <div>
            <label className="block text-sm font-medium mb-2">الفرع</label>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="all">الكل</option>
              {branches.map(branch => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
          </div>

          {/* Amount Filter */}
          <div>
            <label className="block text-sm font-medium mb-2">الحد الأدنى للمبلغ</label>
            <input
              type="number"
              value={minAmount}
              onChange={(e) => setMinAmount(Number(e.target.value))}
              placeholder="0"
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium mb-2">الحالة</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="all">الكل</option>
              <option value="completed">مكتمل</option>
              <option value="pending">قيد الانتظار</option>
              <option value="cancelled">ملغي</option>
            </select>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-8">
          <div className="inline-block">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full"></div>
          </div>
          <p className="mt-2 text-gray-600">جاري معالجة البيانات...</p>
        </div>
      )}

      {/* Results Table */}
      {!isLoading && memoizedSales.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-right text-sm font-semibold">العميل</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">المبلغ</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">الفرع</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">الحالة</th>
                <th className="px-4 py-3 text-right text-sm font-semibold">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {memoizedSales.map(sale => (
                <SalesRow 
                  key={sale.id} 
                  record={sale}
                  onSelect={(id) => console.log('Selected:', id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && memoizedSales.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          لا توجد نتائج تطابق الفلاتر المختارة
        </div>
      )}
    </div>
  );
}

export default CustomerAnalyticsDashboard;
