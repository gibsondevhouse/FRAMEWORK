// Builds the committed, fixed-name, unminified bundle in reader/static/dist/.
// Python-only users never need Node: the dist output is checked into git, and
// test_build_stamp.py verifies it matches these sources (LF-normalized SHA-256
// over the sorted source files, written to dist/build-stamp.json).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function sourceStamp() {
  const files = [...listFiles(join(root, 'src')), join(root, 'index.html')]
    .map((f) => relative(root, f).split(sep).join('/'))
    .sort();
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f + '\n');
    h.update(readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n'));
    h.update('\n');
  }
  return { sha256: h.digest('hex'), files };
}

function buildStampPlugin() {
  return {
    name: 'build-stamp',
    closeBundle() {
      const stamp = sourceStamp();
      writeFileSync(
        join(root, '..', 'static', 'dist', 'build-stamp.json'),
        JSON.stringify(stamp, null, 2) + '\n',
      );
    },
  };
}

export default defineConfig({
  base: '/static/dist/',
  build: {
    outDir: '../static/dist',
    emptyOutDir: true,
    minify: false,
    cssMinify: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: (info) =>
          (info.names?.[0] || '').endsWith('.css') ? 'app.css' : 'assets/[name][extname]',
      },
    },
  },
  plugins: [buildStampPlugin()],
});
