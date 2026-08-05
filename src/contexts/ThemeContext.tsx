import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type AppTheme = 'light' | 'dark' | 'pharmacy-green';

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
  toggleDarkMode: () => void;
  isDark: boolean;
  allowedThemes: readonly AppTheme[];
}

const THEME_STORAGE_KEY = 'dawaa_theme';
const LEGACY_PALETTE_KEY = 'dawaa_palette';
const ALLOWED_THEMES = ['light', 'dark', 'pharmacy-green'] as const satisfies readonly AppTheme[];
const THEME_CLASS_MAP: Record<AppTheme, string[]> = {
  light: ['light-mode', 'theme-light'],
  dark: ['dark-mode', 'theme-dark'],
  'pharmacy-green': ['light-mode', 'theme-pharmacy-green'],
};
const ALL_THEME_CLASSES = Array.from(new Set(Object.values(THEME_CLASS_MAP).flat()));
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function isAllowedTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && (ALLOWED_THEMES as readonly string[]).includes(value);
}

function getInitialTheme(): AppTheme {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isAllowedTheme(stored)) return stored;
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_PALETTE_KEY);
  } catch (e) {
    console.debug('Failed to read theme from localStorage:', e);
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  ALL_THEME_CLASSES.forEach((className) => root.classList.remove(className));
  THEME_CLASS_MAP[theme].forEach((className) => root.classList.add(className));
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  root.removeAttribute('data-palette');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => getInitialTheme());

  useEffect(() => applyTheme(theme), [theme]);

  const setTheme = useCallback((nextTheme: AppTheme) => {
    if (!isAllowedTheme(nextTheme)) return;
    setThemeState(nextTheme);
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        window.localStorage.removeItem(LEGACY_PALETTE_KEY);
      } catch (e) {
        console.debug('Failed to save theme to localStorage:', e);
      }
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const nextTheme: AppTheme = current === 'dark' ? 'light' : 'dark';
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        } catch (e) {
          console.debug('Failed to save theme to localStorage:', e);
        }
      }
      return nextTheme;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      toggleDarkMode: toggleTheme,
      isDark: theme === 'dark',
      allowedThemes: ALLOWED_THEMES,
    }),
    [theme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
