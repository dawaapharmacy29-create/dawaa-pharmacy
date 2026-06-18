---
title: Performance Optimization Guide
description: Comprehensive guide to performance tools and best practices
---

# Performance Optimization Guide

## New Tools & Hooks (Phase 3)

### 1. **useLocalCache** - IndexedDB-based Persistent Caching

**Purpose**: Cache API responses and heavy computations locally with TTL support.

**Usage**:
```typescript
import { useLocalCache } from '@/hooks/useLocalCache';

function Dashboard() {
  const { data, loading, refetch } = useLocalCache(
    'dashboard-metrics',
    async () => {
      const response = await fetch('/api/metrics');
      return response.json();
    },
    { ttlMs: 5 * 60 * 1000 } // 5 minutes
  );

  if (loading) return <Skeleton />;
  return <div>{/* render data */}</div>;
}
```

**Features**:
- Automatic IndexedDB storage with TTL
- Memory fallback if IndexedDB unavailable
- Abort signal support for cleanup
- `refetch(forceRefresh)` for manual updates

---

### 2. **useMemoizedSelector** - Deep Memoization

**Purpose**: Prevent unnecessary re-renders by memoizing derived state.

**Usage**:
```typescript
import { useMemoizedSelector, useMemoizedArray } from '@/hooks/useMemoizedSelector';

function CustomerList({ customers }) {
  // Memoize filtered array
  const activeCustomers = useMemoizedArray(
    customers.filter(c => c.active),
    [customers]
  );

  // Memoize object
  const stats = useMemoizedSelector(
    (data) => ({
      total: data.length,
      active: data.filter((c) => c.active).length,
    }),
    customers
  );

  return <div>{stats.total} total, {stats.active} active</div>;
}
```

**Functions**:
- `useMemoizedSelector()` - Memoize derived values
- `useMemoizedArray()` - Shallow equality for arrays
- `useMemoizedObject()` - Shallow equality for objects
- `useStableCallback()` - Stable callback references

---

### 3. **useDataProcessor** - Web Worker Integration

**Purpose**: Offload heavy computations to background thread.

**Usage**:
```typescript
import { useDataProcessor } from '@/hooks/useDataProcessor';

function Analytics({ data }) {
  const { aggregate, filter, sort, loading } = useDataProcessor();

  const handleAnalyze = async () => {
    // Aggregate in background thread
    const total = await aggregate(data, 'amount', 'sum');
    const avg = await aggregate(data, 'amount', 'avg');

    // Filter with conditions
    const filtered = await filter(data, [
      { field: 'status', op: 'eq', value: 'completed' },
      { field: 'amount', op: 'gt', value: 1000 },
    ]);

    // Sort by multiple fields
    const sorted = await sort(filtered, [
      { field: 'date', ascending: false },
      { field: 'amount', ascending: false },
    ]);
  };

  return (
    <button onClick={handleAnalyze} disabled={loading}>
      {loading ? 'Processing...' : 'Analyze'}
    </button>
  );
}
```

**Supported Operations**:
- `aggregate(rows, field, operation)` - sum, count, avg, min, max
- `filter(rows, conditions)` - eq, ne, gt, gte, lt, lte, contains, in
- `sort(rows, fields)` - Multi-field sorting with direction control

---

## Performance Best Practices

### 1. **Use React.memo() for List Items**
```typescript
const CustomerRow = React.memo(({ customer, onSelect }) => (
  <tr onClick={() => onSelect(customer.id)}>
    <td>{customer.name}</td>
    <td>{customer.email}</td>
  </tr>
), (prev, next) => 
  prev.customer.id === next.customer.id && 
  prev.onSelect === next.onSelect
);
```

### 2. **Use useDeferredValue for Slow Renders**
```typescript
import { useDeferredValue } from 'react';

function CustomerSearch({ searchQuery }) {
  const deferredQuery = useDeferredValue(searchQuery);
  
  const results = useMemo(
    () => customers.filter(c => c.name.includes(deferredQuery)),
    [deferredQuery]
  );

  return (
    <>
      <input value={searchQuery} onChange={...} />
      <List items={results} />
    </>
  );
}
```

### 3. **Lazy Load Heavy Components**
```typescript
const HeavyChart = React.lazy(() => import('@/components/HeavyChart'));

function Dashboard() {
  return (
    <Suspense fallback={<Skeleton />}>
      <HeavyChart />
    </Suspense>
  );
}
```

### 4. **Use Virtualization for Large Lists**
```typescript
import { FixedSizeList } from 'react-window';

function CustomerList({ customers }) {
  const Row = ({ index, style }) => (
    <div style={style}>{customers[index].name}</div>
  );

  return (
    <FixedSizeList
      height={600}
      itemCount={customers.length}
      itemSize={35}
    >
      {Row}
    </FixedSizeList>
  );
}
```

### 5. **Batch Updates with useTransition**
```typescript
import { useTransition } from 'react';

function BulkCustomerImport({ file }) {
  const [isPending, startTransition] = useTransition();

  const handleImport = async () => {
    startTransition(async () => {
      const result = await importCustomersFromFile(file);
      // This doesn't block UI
    });
  };

  return <button onClick={handleImport}>{isPending ? '...' : 'Import'}</button>;
}
```

---

## Measurement & Monitoring

### Bundle Analysis
```bash
ANALYZE=true npm run build
# Opens dist/stats.html with interactive bundle breakdown
```

### Local Performance Testing
```typescript
import { useEffect } from 'react';

function PerformanceMonitor() {
  useEffect(() => {
    // Measure largest contentful paint
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        console.log('LCP:', entry.startTime);
      });
    });
    observer.observe({ entryTypes: ['largest-contentful-paint'] });
    
    return () => observer.disconnect();
  }, []);

  return null;
}
```

### Native Web Vitals
```typescript
import { getCLS, getFCP, getFID, getLCP, getTTFB } from 'web-vitals';

export function reportWebVitals() {
  getCLS(console.log);
  getFCP(console.log);
  getFID(console.log);
  getLCP(console.log);
  getTTFB(console.log);
}
```

---

## Implementation Priority

### High Impact (Start Here)
1. ✅ Add `useLocalCache` to heavy API calls (Dashboard, Analytics)
2. ✅ Add `React.memo` to Customer list rows
3. ✅ Use `useDataProcessor` for bulk operations

### Medium Impact
4. Add `useMemoizedSelector` to derived state calculations
5. Implement `useDeferredValue` for search/filter inputs
6. Lazy load secondary charts and modals

### Low Impact (Future)
7. Set up Web Worker for real-time calculations
8. Implement IndexedDB for offline support
9. Add Service Worker caching headers (Vercel config)

---

## Vercel Deployment Optimization

### HTTP Caching Headers (vercel.json)
```json
{
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=60, s-maxage=120"
        }
      ]
    }
  ]
}
```

---

## Migration Checklist

- [ ] Update Dashboard page with `useLocalCache` for metrics
- [ ] Add `React.memo` to CustomerRow and invoice table rows
- [ ] Replace heavy filters with `useDataProcessor`
- [ ] Test bundle size: `npm run build && ls -lh dist/assets/*.js`
- [ ] Deploy and measure Core Web Vitals
- [ ] Document any breaking changes

---

## Troubleshooting

**Q: useLocalCache not persisting?**
A: Check browser DevTools → Application → IndexedDB. Ensure site has storage permissions.

**Q: useDataProcessor not loading worker?**
A: Worker requires module support. Check browser console for errors. Falls back to main thread.

**Q: React.memo not preventing re-renders?**
A: Ensure props are referentially equal. Use `useMemoizedObject()` for object props.

**Q: Build time increased?**
A: Verify no duplicate imports of heavy libraries. Check bundle analysis output.

---

## Next Steps

1. Run `ANALYZE=true npm run build` to see current bundle breakdown
2. Identify 3-5 heaviest pages/components
3. Apply `useLocalCache` to top API calls in those pages
4. Test performance impact with Lighthouse
5. Repeat for next batch of optimizations

Good luck! 🚀
