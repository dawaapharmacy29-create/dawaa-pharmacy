import { useEffect, useState } from "react";
import type { AppTheme } from "@/context/ThemeContext";
import { isAllowedTheme } from "@/context/ThemeContext";

const THEME_KEY = "dawaa_theme";
const LEGACY_PALETTE_KEY = "dawaa_palette";
const THEME_CLASSES = ["light-mode", "dark-mode", "theme-light", "theme-dark", "theme-pharmacy-green"];
const THEME_CLASS_MAP: Record<AppTheme, string[]> = {
  light: ["light-mode", "theme-light"],
  dark: ["dark-mode", "theme-dark"],
  "pharmacy-green": ["light-mode", "theme-pharmacy-green"],
};

function readTheme(): AppTheme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_KEY);
  if (isAllowedTheme(stored)) return stored;
  window.localStorage.removeItem(THEME_KEY);
  window.localStorage.removeItem(LEGACY_PALETTE_KEY);
  return "dark";
}

function applyTheme(theme: AppTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  THEME_CLASSES.forEach((className) => root.classList.remove(className));
  THEME_CLASS_MAP[theme].forEach((className) => root.classList.add(className));
  root.dataset.theme = theme;
  root.style.colorScheme = theme === "dark" ? "dark" : "light";
  root.removeAttribute("data-palette");
}

export function useTheme() {
  const [theme, setThemeState] = useState<AppTheme>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
    localStorage.removeItem(LEGACY_PALETTE_KEY);
  }, [theme]);

  const setTheme = (nextTheme: AppTheme) => {
    if (!isAllowedTheme(nextTheme)) return;
    setThemeState(nextTheme);
  };

  const toggleTheme = () => setThemeState((current) => (current === "dark" ? "light" : "dark"));
  return { theme, setTheme, toggleTheme, isDark: theme === "dark" };
}
