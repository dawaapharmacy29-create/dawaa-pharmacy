import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'url';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

// Visual-review deployments have no Supabase connection. These values are
// overridden before Vite resolves client env; branch-scoped demo never loads live data.
// Normal Production/Preview builds are unchanged unless explicit demo flag is set.
if (process.env.VITE_DAWAA_ATTENDANCE_DRAWER_DEMO === '1' && process.env.VERCEL_ENV === 'preview') {
  process.env.VITE_SUPABASE_URL = '';
  process.env.VITE_SUPABASE_ANON_KEY = '';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let isViteDevServer = false;
const localDevelopmentCsp = {
  name: 'local-development-csp',
  configResolved(config: { command: string }) {
    isViteDevServer = config.command === 'serve';
  },
  transformIndexHtml(html: string, context: { server?: unknown }) {
    if (!isViteDevServer || !context.server) return html;

    return html.replace(
      /(<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*?connect-src\s+)([^;]*)(;[^"]*")/i,
      (meta, prefix: string, sources: string, suffix: string) => {
        const localOrigins = [
          'http://127.0.0.1:54321',
          'http://localhost:54321',
          'ws://127.0.0.1:54321',
          'ws://localhost:54321',
        ];
        const additions = localOrigins.filter((origin) => !sources.split(/\s+/).includes(origin));
        return additions.length ? `${prefix}${sources} ${additions.join(' ')}${suffix}` : meta;
      }
    );
  },
};

const plugins = [react(), localDevelopmentCsp];
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