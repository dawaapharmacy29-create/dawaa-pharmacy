import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'url';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const plugins = [react()];
if (process.env.ANALYZE === 'true') {
  plugins.push(visualizer({ filename: 'dist/stats.html', open: true, gzipSize: true }));
}

export default defineConfig({
  base: '/',
  css: {
    postcss: {
      plugins: [(await import('tailwindcss')).default, (await import('autoprefixer')).default],
    },
  },
  plugins,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    target: ['es2019', 'safari13'],
    minify: 'esbuild',
    chunkSizeWarningLimit: 1000,
    modulePreload: {
      resolveDependencies(_filename, deps, context) {
        // Export engines are large and optional. Do not make Login/startup wait for
        // PDF/Excel code; lazy routes still fetch them normally when needed.
        if (context.hostType !== 'html') return deps;
        return deps.filter((dep) => !/(?:^|\/)assets\/(?:pdf|excel)-/i.test(dep));
      },
    },
    rollupOptions: {
      output: {
        // Only truly shared/runtime-critical libraries are forced into named chunks.
        // Unclassified node_modules intentionally return undefined so Rollup can keep
        // route-only dependencies (PDF tools, niche editors, etc.) inside lazy graphs.
        // A catch-all `vendor` chunk previously made lazy-only packages part of startup.
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');

          // Keep modules shared by App.tsx and the Reviews route out of the App chunk.
          // Otherwise Rollup can make ReviewsEnhanced depend back on App while App lazily
          // imports ReviewsEnhanced, creating a circular async chunk graph on /reviews.
          if (normalizedId.includes('/src/contexts/NavigationGuardContext'))
            return 'navigation-guard';
          if (normalizedId.includes('/src/lib/security/userDataScope')) return 'user-data-scope';
          if (normalizedId.includes('/src/lib/pharmacy-cycle')) return 'pharmacy-cycle';
          if (normalizedId.includes('/src/lib/notificationService')) return 'notification-service';
          if (normalizedId.includes('/src/lib/activityLog')) return 'activity-log';
          if (normalizedId.includes('/src/lib/utils')) return 'app-utils';

          if (normalizedId.includes('node_modules')) {
            if (
              normalizedId.includes('react-dom') ||
              normalizedId.includes('react/') ||
              normalizedId.includes('scheduler')
            )
              return 'react-core';
            if (normalizedId.includes('react-router')) return 'router';
            if (normalizedId.includes('@supabase')) return 'supabase';
            if (normalizedId.includes('@tanstack/react-query')) return 'query';
            if (normalizedId.includes('recharts') || normalizedId.includes('d3-')) return 'charts';
            if (
              normalizedId.includes('react-hook-form') ||
              normalizedId.includes('@hookform') ||
              normalizedId.includes('zod')
            )
              return 'forms';
            if (normalizedId.includes('date-fns')) return 'date-fns';
            if (normalizedId.includes('@radix-ui')) return 'radix';
            if (normalizedId.includes('lucide-react') || normalizedId.includes('react-icons'))
              return 'icons';
            if (normalizedId.includes('framer-motion')) return 'motion';
            if (normalizedId.includes('leaflet') || normalizedId.includes('react-leaflet'))
              return 'maps';
            if (normalizedId.includes('xlsx') || normalizedId.includes('exceljs')) return 'excel';
            if (normalizedId.includes('/qrcode/')) return 'qrcode';
            if (
              normalizedId.includes('react-calendar') ||
              normalizedId.includes('react-day-picker')
            )
              return 'calendar';
            if (normalizedId.includes('react-dropzone')) return 'upload';
            if (normalizedId.includes('react-window')) return 'virtual-list';
            if (normalizedId.includes('embla-carousel')) return 'carousel';
            if (normalizedId.includes('zustand')) return 'state';
            if (
              normalizedId.includes('sonner') ||
              normalizedId.includes('vaul') ||
              normalizedId.includes('cmdk')
            )
              return 'ui-feedback';
            return undefined;
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
  },
});