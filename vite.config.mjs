import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: mode === "production",
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/react-router-dom/")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/@supabase/")) {
            return "vendor-supabase";
          }
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
            return "vendor-charts";
          }
          if (id.includes("node_modules/xlsx")) {
            return "vendor-xlsx";
          }
          if (id.includes("node_modules/jspdf") || id.includes("node_modules/html2canvas")) {
            return "vendor-pdf";
          }
          if (id.includes("node_modules/sonner") || id.includes("node_modules/lucide-react")) {
            return "vendor-ui";
          }
          if (id.includes("node_modules/clsx") || id.includes("node_modules/tailwind-merge") || id.includes("node_modules/class-variance-authority")) {
            return "vendor-utils";
          }
          if (id.includes("node_modules/@radix-ui/")) {
            return "vendor-radix";
          }
          if (id.includes("node_modules/framer-motion")) {
            return "vendor-motion";
          }
          if (id.includes("node_modules/zustand") || id.includes("node_modules/@reduxjs/") || id.includes("node_modules/react-redux")) {
            return "vendor-state";
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
}));
