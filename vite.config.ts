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
    target: 'es2020',
    // Tree-shake unused exports
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // More granular chunks = better caching + smaller initial load
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Core React runtime
            if (id.includes('react-dom') || id.includes('react/') || id.includes('scheduler'))
              return 'react-core';
            // Router
            if (id.includes('react-router')) return 'router';
            // Supabase
            if (id.includes('@supabase')) return 'supabase';
            // Data fetching cache
            if (id.includes('@tanstack/react-query')) return 'query';
            // Charts (recharts only — chart.js removed)
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            // Forms
            if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod'))
              return 'forms';
            // Date utilities
            if (id.includes('date-fns')) return 'date-fns';
            // Radix UI primitives
            if (id.includes('@radix-ui')) return 'radix';
            // Icons
            if (id.includes('lucide-react') || id.includes('react-icons')) return 'icons';
            // Framer motion (animations)
            if (id.includes('framer-motion')) return 'motion';
            // Map libs (load only when needed)
            if (id.includes('leaflet')) return 'maps';
            // Excel export
            if (id.includes('xlsx') || id.includes('exceljs')) return 'excel';
            // Everything else vendor
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
