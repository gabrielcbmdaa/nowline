/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    /**
     * The browser keys storage by origin, and the origin includes the port, so a
     * server that quietly hops to the next free port comes back with an empty app.
     * Pin it, and refuse to start rather than move.
     */
    port: 5124,
    strictPort: true,
    /**
     * The app always calls `/api/...` on its own origin, in development and in
     * production alike. In production nginx forwards that path to the node
     * process; here vite does. Pointing the app straight at 127.0.0.1:3001
     * would be a second origin — CORS rules, and a different code path in
     * development from the one that ships.
     */
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  preview: {
    /**
     * The same origin as `pnpm dev`, on purpose: the production build is looked
     * at against the data already on this machine. Vite's default is 4173, which
     * is another origin and therefore another, empty store. `strictPort` and the
     * `/api` proxy are inherited from `server`; only the port is not. If dev is
     * still up, preview refuses — one app on one origin at a time, as dev does.
     */
    port: 5124,
  },
  test: {
    environment: 'node',
    // Compiled emit is not the suite, which is why dist/ is already excluded
    // by default. dist-server/ is the same kind of folder and is not.
    exclude: [...configDefaults.exclude, 'dist-server/**'],
    /**
     * Pinned so date tests mean the same thing on every machine. Madrid because it
     * changes its clocks and the developer's zone, La Paz, has not since 1932: with
     * the local zone a daylight saving test would pass here by proving nothing.
     */
    env: { TZ: 'Europe/Madrid' },
  },
});
