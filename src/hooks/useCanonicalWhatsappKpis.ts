import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';
import {
  loadCanonicalWhatsappKpis,
  type CanonicalKpiCase,
  type CanonicalKpiScope,
} from '@/lib/salesIntelligence/canonicalKpiReadModel';

export function useCanonicalWhatsappKpis(scope: CanonicalKpiScope) {
  const { user } = useAuth();
  const viewer = user?.id;
  const [state, setState] = useState<{
    facts: CanonicalKpiCase[];
    loading: boolean;
    error: string | null;
    key: string;
  }>({ facts: [], loading: true, error: null, key: '' });
  const key = JSON.stringify([
    viewer,
    scope.start,
    scope.endExclusive,
    scope.branch,
    scope.staffId,
  ]);
  useEffect(() => {
    let cancelled = false;
    setState({ facts: [], loading: true, error: null, key });
    loadCanonicalWhatsappKpis(supabase, scope)
      .then((facts) => {
        if (!cancelled) setState({ facts, loading: false, error: null, key });
      })
      .catch((cause) => {
        if (!cancelled)
          setState({
            facts: [],
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause?.message ?? cause),
            key,
          });
      });
    return () => {
      cancelled = true;
    };
    // The serialized key includes every scope field and viewer identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { facts: [], loading: true, error: null, key };
}
