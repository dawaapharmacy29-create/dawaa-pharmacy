import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { Loader2, Save, X } from 'lucide-react';

export type UnsavedChangesGuardHandlers = {
  isDirty: () => boolean;
  isSaving: () => boolean;
  onSave: () => Promise<boolean>;
};

type NavigationGuardContextValue = {
  registerGuard: (id: string, handlers: UnsavedChangesGuardHandlers) => void;
  unregisterGuard: (id: string) => void;
  requestNavigation: (target: string) => void;
  hasActiveDirtyGuard: () => boolean;
};

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

function activeGuard(
  guards: Map<string, UnsavedChangesGuardHandlers>
): UnsavedChangesGuardHandlers | null {
  for (const guard of guards.values()) {
    try {
      if (guard.isDirty()) return guard;
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[navigation-guard] isDirty failed', error);
    }
  }
  return null;
}

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const guardsRef = useRef(new Map<string, UnsavedChangesGuardHandlers>());
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const proceedRef = useRef<(() => void) | null>(null);

  const registerGuard = useCallback((id: string, handlers: UnsavedChangesGuardHandlers) => {
    guardsRef.current.set(id, handlers);
  }, []);

  const unregisterGuard = useCallback((id: string) => {
    guardsRef.current.delete(id);
  }, []);

  const hasActiveDirtyGuard = useCallback(() => Boolean(activeGuard(guardsRef.current)), []);

  const completeNavigation = useCallback(
    (target: string) => {
      setModalOpen(false);
      setPendingTarget(null);
      setModalError(null);
      proceedRef.current?.();
      proceedRef.current = null;
      navigate(target.startsWith('/') ? target : '/operations-center');
    },
    [navigate]
  );

  const openModal = useCallback((target: string, onProceed?: () => void) => {
    setPendingTarget(target);
    setModalError(null);
    setModalOpen(true);
    proceedRef.current = onProceed || null;
  }, []);

  const requestNavigation = useCallback(
    (target: string) => {
      const guard = activeGuard(guardsRef.current);
      if (!guard) {
        navigate(target.startsWith('/') ? target : '/operations-center');
        return;
      }
      openModal(target);
    },
    [navigate, openModal]
  );

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (modalOpen || saving) return false;
    const guard = activeGuard(guardsRef.current);
    if (!guard) return false;
    return (
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search
    );
  });

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const next = `${blocker.location.pathname}${blocker.location.search || ''}`;
    openModal(next, () => blocker.proceed?.());
  }, [blocker, openModal]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!activeGuard(guardsRef.current)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const handleSaveAndNavigate = useCallback(async () => {
    if (!pendingTarget) return;
    const guard = activeGuard(guardsRef.current);
    if (!guard) {
      completeNavigation(pendingTarget);
      return;
    }
    setSaving(true);
    setModalError(null);
    try {
      const ok = await guard.onSave();
      if (!ok) {
        setModalError('تعذر حفظ التقييم. راجع البيانات وحاول مرة أخرى.');
        return;
      }
      completeNavigation(pendingTarget);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'تعذر حفظ التقييم');
    } finally {
      setSaving(false);
    }
  }, [completeNavigation, pendingTarget]);

  const handleDiscard = useCallback(() => {
    if (!pendingTarget) return;
    completeNavigation(pendingTarget);
  }, [completeNavigation, pendingTarget]);

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    setPendingTarget(null);
    setModalError(null);
    if (blocker.state === 'blocked') blocker.reset?.();
    proceedRef.current = null;
  }, [blocker]);

  const value = useMemo(
    () => ({ registerGuard, unregisterGuard, requestNavigation, hasActiveDirtyGuard }),
    [hasActiveDirtyGuard, registerGuard, requestNavigation, unregisterGuard]
  );

  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/60" onClick={handleCancel} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-amber-400/30 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-white">تقييم غير محفوظ</h3>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  لديك تقييم غير محفوظ. هل تريد حفظه قبل الانتقال؟
                </p>
              </div>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            {modalError && (
              <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm font-bold text-red-100">
                {modalError}
              </div>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveAndNavigate()}
                className="btn-primary inline-flex flex-1 items-center justify-center gap-2 disabled:opacity-60"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                حفظ ثم الانتقال
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleDiscard}
                className="btn-secondary flex-1"
              >
                الانتقال بدون حفظ
              </button>
              <button type="button" disabled={saving} onClick={handleCancel} className="btn-secondary flex-1">
                إلغاء والبقاء
              </button>
            </div>
          </div>
        </div>
      )}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard() {
  const ctx = useContext(NavigationGuardContext);
  if (!ctx) {
    throw new Error('useNavigationGuard must be used within NavigationGuardProvider');
  }
  return ctx;
}

export function useOptionalNavigationGuard() {
  return useContext(NavigationGuardContext);
}
