'use strict';

const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: ['server/sales-intelligence-refresh-source.ts'],
  outfile: 'api/sales-intelligence-refresh-source.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  sourcemap: false,
  minify: false,
  packages: 'external',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': 'process.env.VITE_SUPABASE_URL',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': 'process.env.VITE_SUPABASE_ANON_KEY',
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.env.MODE': '"server"',
  },
  logLevel: 'info',
});
