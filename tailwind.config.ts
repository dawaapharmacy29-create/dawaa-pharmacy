import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        cairo: ["Cairo", "sans-serif"],
        tajawal: ["Tajawal", "sans-serif"],
        sans: ["Tajawal", "Cairo", "IBM Plex Sans Arabic", "Noto Sans Arabic", "system-ui", "sans-serif"],
      },
      colors: {
        // Brand Colors from Logo
        navy: {
          50: "#e8edf5",
          100: "#c5d0e6",
          200: "#9fb0d5",
          300: "#7890c4",
          400: "#5a77b8",
          500: "#3b5dac",
          600: "#2d4d8f",
          700: "#1B2B4B",
          800: "#152238",
          900: "#0F1923",
          950: "#090f15",
        },
        teal: {
          50: "#e0faf6",
          100: "#b3f3ea",
          200: "#80ebdc",
          300: "#4de3ce",
          400: "#26dcc4",
          500: "#00C9A7",
          600: "#00b596",
          700: "#009d82",
          800: "#00876f",
          900: "#006d59",
        },
        // Semantic
        brand: {
          primary: "#1B2B4B",
          accent: "#00C9A7",
          surface: "#243558",
          border: "#2d4063",
          muted: "#6b7a99",
        },
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #1B2B4B 0%, #243558 100%)",
        "accent-gradient": "linear-gradient(135deg, #00C9A7 0%, #00a589 100%)",
        "card-gradient": "linear-gradient(145deg, #243558 0%, #1B2B4B 100%)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-in": "slideIn 0.3s ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          "0%": { opacity: "0", transform: "translateX(-16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
