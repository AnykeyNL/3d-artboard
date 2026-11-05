import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages or any static host.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
  test: { include: ['test/**/*.test.ts'] },
} as any);
