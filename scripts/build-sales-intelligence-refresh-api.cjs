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
  logLevel: 'info',
});
