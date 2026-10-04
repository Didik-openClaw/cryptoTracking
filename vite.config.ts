import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset paths relative so the build works on GitHub Pages
// sub-paths (https://<user>.github.io/<repo>/), Netlify, Vercel, or any static host.
// `--mode demo` builds demo.html instead: the same app on a simulated market.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  build: {
    // React + lightweight-charts is ~160 KB gzipped; one bundle is fine for this app.
    chunkSizeWarningLimit: 800,
    ...(mode === 'demo' && { outDir: 'dist-demo', rolldownOptions: { input: 'demo.html' } }),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
