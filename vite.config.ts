import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * One Vite build per page so each public page ships its own assets folder:
 *   (default) index.html        → dist/          (the terminal, behind the access gate)
 *   --mode demo  demo/index.html  → dist/demo/   (public demo on a simulated market)
 *   --mode beli  beli/index.html  → dist/beli/   (public buy page)
 *   --mode admin admin/index.html → dist/admin/  (admin panel; its API needs the admin password)
 * The gate only lets /demo, /beli, /admin and /api through without a session,
 * so those pages must not load files from the protected dist/assets.
 *
 * `base: './'` keeps every path relative, so the build works from any host or sub-path.
 */
const PAGES: Record<string, string> = { demo: 'demo', beli: 'beli', admin: 'admin' };

export default defineConfig(({ mode }) => {
  const page = PAGES[mode];
  return {
    base: './',
    plugins: [react()],
    build: {
      // React + lightweight-charts is ~170 KB gzipped; one bundle is fine for this app.
      chunkSizeWarningLimit: 800,
      ...(page && {
        emptyOutDir: false,
        assetsDir: `${page}/assets`,
        rolldownOptions: { input: `${page}/index.html` },
      }),
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.mjs'],
    },
  };
});
