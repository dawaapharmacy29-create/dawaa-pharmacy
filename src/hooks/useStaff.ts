import { useActiveStaff } from "@/hooks/useActiveStaff";

export function useStaff<T>(options?: { includeInactive?: boolean }) {
  return useActiveStaff<T>({ includeInactive: options?.includeInactive, realtimeEnabled: true });
}
