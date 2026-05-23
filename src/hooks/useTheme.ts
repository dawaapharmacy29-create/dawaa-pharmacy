import { useState, useEffect } from "react";

type Theme = "dark" | "light";

/** لوحات ألوان Dawaa 2027: الفيروزي هو الافتراضي النهائي، مع الملكي والغابة كبدائل */
export type PaletteId = "aqua" | "royal" | "forest";

const PALETTE_KEY = "dawaa_palette";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("dawaa_theme") as Theme) || "dark";
  });

  const [palette, setPalette] = useState<PaletteId>(() => {
    const s = localStorage.getItem(PALETTE_KEY) as PaletteId | null;
    return s === "royal" || s === "forest" || s === "aqua" ? s : "aqua";
  });

  useEffect(() => {
    localStorage.setItem("dawaa_theme", theme);
    document.documentElement.classList.toggle("light-mode", theme === "light");
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(PALETTE_KEY, palette);
    document.documentElement.dataset.palette = palette;
  }, [palette]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return { theme, setTheme, toggleTheme, palette, setPalette };
}
