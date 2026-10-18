import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { include: ['src/model/links.ts', 'src/model/permissions.ts', 'src/model/formula.ts', 'src/model/graph.ts'], thresholds: { lines: 80, functions: 80 } },
  },
} as any);
