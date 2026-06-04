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
    // إزالة console.log/warn/error تلقائياً في production
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: mode === "production",
        drop_debugger: true,
      },
    },
    // تقسيم الـ chunks لتحسين التحميل الأول
    rollupOptions: {
      output: {
        manualChunks(id) {
          // مكتبات React الأساسية — دايماً محتاجينها
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/react-router-dom/")) {
            return "vendor-react";
          }
          // Supabase — كبير وما بيتغيرش كثير
          if (id.includes("node_modules/@supabase/")) {
            return "vendor-supabase";
          }
          // Recharts — مكتبة الرسوم البيانية ضخمة
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
            return "vendor-charts";
          }
          // XLSX — مكتبة الإكسل ضخمة جداً
          if (id.includes("node_modules/xlsx")) {
            return "vendor-xlsx";
          }
          // UI — مكتبات الواجهة الصغيرة
          if (id.includes("node_modules/sonner") || id.includes("node_modules/lucide-react")) {
            return "vendor-ui";
          }
          // clsx / tailwind-merge / class-variance-authority
          if (id.includes("node_modules/clsx") || id.includes("node_modules/tailwind-merge") || id.includes("node_modules/class-variance-authority")) {
            return "vendor-utils";
          }
        },
      },
    },
    // تحذير عند حجم chunk كبير
    chunkSizeWarningLimit: 600,
  },
}));
