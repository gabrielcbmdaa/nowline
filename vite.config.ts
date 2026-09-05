/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  },
  test: {
    environment: 'node',
    /**
     * Pinned so date tests mean the same thing on every machine. Madrid because it
     * changes its clocks and the developer's zone, La Paz, has not since 1932: with
     * the local zone a daylight saving test would pass here by proving nothing.
     */
    env: { TZ: 'Europe/Madrid' },
  },
});
