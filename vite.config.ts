import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset paths relative so the build works on GitHub Pages
// sub-paths (https://<user>.github.io/<repo>/), Netlify, Vercel, or any static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  // React + lightweight-charts is ~160 KB gzipped; one bundle is fine for this app.
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
