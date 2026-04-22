import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await Promise.all([
  build({
    entryPoints: ['src/content.ts'],
    bundle: true,
    outfile: 'dist/content.js',
    format: 'iife',
    target: 'chrome120',
  }),
  build({
    entryPoints: ['src/background.ts'],
    bundle: true,
    outfile: 'dist/background.js',
    format: 'esm',
    target: 'chrome120',
  }),
]);

copyFileSync('manifest.json', 'dist/manifest.json');
console.log('built dist/');
