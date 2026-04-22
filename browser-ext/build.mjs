import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
mkdirSync('dist/icons', { recursive: true });

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

// Copy icons if they exist in source
try {
  for (const f of readdirSync('icons')) {
    copyFileSync(`icons/${f}`, `dist/icons/${f}`);
  }
} catch {}

console.log('built dist/');
