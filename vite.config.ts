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
    rollupOptions: {
      output: {
        // Granular chunks improve caching and keep route-only tools out of the first load.
        // PDF libraries intentionally stay with their lazy route graph instead of being
        // forced into a global manual chunk, which previously made that chunk static.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react/') || id.includes('scheduler'))
              return 'react-core';
            if (id.includes('react-router')) return 'router';
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('@tanstack/react-query')) return 'query';
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod'))
              return 'forms';
            if (id.includes('date-fns')) return 'date-fns';
            if (id.includes('@radix-ui')) return 'radix';
            if (id.includes('lucide-react') || id.includes('react-icons')) return 'icons';
            if (id.includes('framer-motion')) return 'motion';
            if (id.includes('leaflet') || id.includes('react-leaflet')) return 'maps';
            if (id.includes('xlsx') || id.includes('exceljs')) return 'excel';
            if (id.includes('/qrcode/')) return 'qrcode';
            if (id.includes('react-calendar') || id.includes('react-day-picker')) return 'calendar';
            if (id.includes('react-dropzone')) return 'upload';
            if (id.includes('react-window')) return 'virtual-list';
            if (id.includes('embla-carousel')) return 'carousel';
            if (id.includes('zustand')) return 'state';
            if (id.includes('sonner') || id.includes('vaul') || id.includes('cmdk')) return 'ui-feedback';
            return 'vendor';
          }
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
