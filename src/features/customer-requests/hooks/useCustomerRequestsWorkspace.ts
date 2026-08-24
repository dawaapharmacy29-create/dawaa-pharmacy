import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import {
  customerRequestsRepository,
  type CustomerRequestCommandSummary,
  type CustomerRequestPageOptions,
  type CustomerRequestPageResult,
  type CustomerRequestQuickFilter,
} from '../data';
import { customerRequestOperationalView } from '../domain/request';

const EMPTY_PAGE: CustomerRequestPageResult = {
  rows: [],
  count: 0,
  page: 1,
  pageSize: 30,
  pages: 1,
};

const EMPTY_SUMMARY: CustomerRequestCommandSummary = {
  total: 0,
  today: 0,
  open: 0,
  attention: 0,
  urgent: 0,
  overdue: 0,
  searching: 0,
  waiting_customer: 0,
  ready: 0,
  delivered: 0,
  not_available: 0,
  cancelled: 0,
  from_dawaawael: 0,
  unlinked_customer: 0,
  no_branch: 0,
  invalid_phone: 0,
  unassigned: 0,
  sync_conflicts: 0,
  moved_to_shortage: 0,
  fulfillment_rate: 0,
  avg_fulfillment_hours: 0,
};

export interface CustomerRequestsWorkspaceFilters
  extends Omit<CustomerRequestPageOptions, 'page' | 'pageSize'> {
  quickFilter?: CustomerRequestQuickFilter;
}

export interface CustomerRequestsWorkspaceState {
  filters: CustomerRequestsWorkspaceFilters;
  page: number;
  pageSize: number;
}

export interface UseCustomerRequestsWorkspaceOptions {
  initialFilters?: CustomerRequestsWorkspaceFilters;
  initialPage?: number;
  pageSize?: number;
  debounceMs?: number;
}

export function useCustomerRequestsWorkspace(options: UseCustomerRequestsWorkspaceOptions = {}) {
  const [filters, setFilters] = useState<CustomerRequestsWorkspaceFilters>({
    quickFilter: 'attention',
    branch: 'all',
    ...options.initialFilters,
  });
  const [page, setPage] = useState(Math.max(1, options.initialPage || 1));
  const [pageSize, setPageSize] = useState(Math.min(100, Math.max(10, options.pageSize || 30)));
  const [result, setResult] = useState<CustomerRequestPageResult>({ ...EMPTY_PAGE, pageSize });
  const [summary, setSummary] = useState<CustomerRequestCommandSummary>(EMPTY_SUMMARY);
  const [listLoading, setListLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedRequestSnapshot, setSelectedRequestSnapshot] = useState<CustomerRequest | null>(null);
  const listRequestId = useRef(0);
  const summaryRequestId = useRef(0);
  const debounceMs = Math.max(0, options.debounceMs ?? 250);

  const queryOptions = useMemo<CustomerRequestPageOptions>(
    () => ({ ...filters, page, pageSize }),
    [filters, page, pageSize]
  );

  const loadList = useCallback(async () => {
    const requestId = ++listRequestId.current;
    setListLoading(true);
    setListError(null);
    try {
      const next = await customerRequestsRepository.getPage(queryOptions);
      if (requestId !== listRequestId.current) return;
      setResult(next);
      setSelectedRequestSnapshot((current) => {
        if (!current) return current;
        return next.rows.find((row) => row.id === current.id) || current;
      });
    } catch (error) {
      if (requestId !== listRequestId.current) return;
      setListError(error instanceof Error ? error.message : 'تعذر تحميل طلبات العملاء');
    } finally {
      if (requestId === listRequestId.current) setListLoading(false);
    }
  }, [queryOptions]);

  const loadSummary = useCallback(async () => {
    const requestId = ++summaryRequestId.current;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const next = await customerRequestsRepository.getSummary(filters.branch || 'all');
      if (requestId !== summaryRequestId.current) return;
      setSummary(next);
    } catch (error) {
      if (requestId !== summaryRequestId.current) return;
      setSummaryError(error instanceof Error ? error.message : 'تعذر تحميل ملخص الطلبات');
    } finally {
      if (requestId === summaryRequestId.current) setSummaryLoading(false);
    }
  }, [filters.branch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadList(), debounceMs);
    return () => window.clearTimeout(timeout);
  }, [loadList, debounceMs]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const updateFilters = useCallback((patch: Partial<CustomerRequestsWorkspaceFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }, []);

  const replaceFilters = useCallback((next: CustomerRequestsWorkspaceFilters) => {
    setFilters(next);
    setPage(1);
  }, []);

  const selectRequest = useCallback((request: CustomerRequest | string | null) => {
    if (!request) {
      setSelectedRequestId(null);
      setSelectedRequestSnapshot(null);
      return;
    }
    if (typeof request === 'string') {
      setSelectedRequestId(request);
      setSelectedRequestSnapshot((current) => current?.id === request ? current : null);
      return;
    }
    setSelectedRequestId(request.id);
    setSelectedRequestSnapshot(request);
  }, []);

  const updateSelectedRequest = useCallback((request: CustomerRequest) => {
    setSelectedRequestId(request.id);
    setSelectedRequestSnapshot(request);
    setResult((current) => ({
      ...current,
      rows: current.rows.map((row) => row.id === request.id ? request : row),
    }));
  }, []);

  const selectedRequest = useMemo(() => {
    if (!selectedRequestId) return null;
    return result.rows.find((row) => row.id === selectedRequestId) || selectedRequestSnapshot;
  }, [result.rows, selectedRequestId, selectedRequestSnapshot]);

  const operationalRows = useMemo(
    () => result.rows.map((row) => ({ request: row, view: customerRequestOperationalView(row) })),
    [result.rows]
  );

  const refresh = useCallback(async () => {
    await Promise.allSettled([loadList(), loadSummary()]);
  }, [loadList, loadSummary]);

  return {
    filters,
    updateFilters,
    replaceFilters,
    page,
    setPage,
    pageSize,
    setPageSize: (value: number) => {
      setPageSize(Math.min(100, Math.max(10, value)));
      setPage(1);
    },
    rows: result.rows,
    operationalRows,
    count: result.count,
    pages: result.pages,
    summary,
    listLoading,
    summaryLoading,
    loading: listLoading || summaryLoading,
    listError,
    summaryError,
    selectedRequest,
    selectedRequestId,
    selectRequest,
    updateSelectedRequest,
    refresh,
  };
}
