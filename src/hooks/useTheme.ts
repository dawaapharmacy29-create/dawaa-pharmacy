import { useThemeContext } from '@/contexts/ThemeContext';

/**
 * Compatibility hook for existing components.
 * ThemeContext is the single source of truth and the only runtime writer
 * allowed to mutate the document theme classes / data-theme attribute.
 */
export function useTheme() {
  const { theme, setTheme, toggleTheme, isDark, allowedThemes } = useThemeContext();
  return { theme, setTheme, toggleTheme, isDark, allowedThemes };
}
