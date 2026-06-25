import { useEffect, useId, useRef } from 'react';
import type { UnsavedChangesGuardHandlers } from '@/contexts/NavigationGuardContext';
import { useNavigationGuard } from '@/contexts/NavigationGuardContext';

export function useUnsavedChangesGuard(handlers: UnsavedChangesGuardHandlers) {
  const id = useId();
  const { registerGuard, unregisterGuard } = useNavigationGuard();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    registerGuard(id, {
      isDirty: () => handlersRef.current.isDirty(),
      isSaving: () => handlersRef.current.isSaving(),
      onSave: () => handlersRef.current.onSave(),
    });
    return () => unregisterGuard(id);
  }, [id, registerGuard, unregisterGuard]);
}

export function usePendingFormNavigationGuard(options: {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => Promise<boolean>;
}) {
  useUnsavedChangesGuard({
    isDirty: () => options.isDirty,
    isSaving: () => options.isSaving,
    onSave: options.onSave,
  });
}
