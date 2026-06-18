import { useEffect } from 'react';

/**
 * Closes a modal when the Escape key is pressed.
 * @param onClose - The function to call to close the modal
 * @param active - Whether the modal is currently open (default: true)
 */
export function useEscapeKey(onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, active]);
}
