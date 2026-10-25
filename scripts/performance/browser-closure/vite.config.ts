import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);

export default defineConfig({
  root,
  base: '/',
  plugins: [react()],
  css: { postcss: { plugins: [(await import('tailwindcss')).default, (await import('autoprefixer')).default] } },
  resolve: {
    alias: [
      // Production profiling is opt-in; this alias applies only to the synthetic harness.
      { find: 'react-dom/client', replacement: require.resolve('react-dom/profiling') },
      { find: '@/lib/supabase', replacement: path.resolve(here, 'fakeSupabase.ts') },
      { find: '@', replacement: path.resolve(root, 'src') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: path.resolve(here, 'dist'), emptyOutDir: true, target: 'es2020', minify: 'esbuild',
    rollupOptions: { input: path.resolve(here, 'index.html') },
  },
  preview: { host: '127.0.0.1', port: 4174 },
});
