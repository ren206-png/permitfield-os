import { defineConfig } from 'vitest/config';
import path from 'node:path';

// This repo's first test config (Lifecycle & Compliance Expansion, Phase
// 1.0). Only the `@/*` alias from tsconfig.json is mirrored here -- no
// Next.js/React plugin, no jsdom environment -- because the first tests this
// phase adds (lib/authz) are pure functions with zero framework dependency.
// A later phase that needs to test a Server Action or a React component will
// need to extend this file (e.g. `environment: 'jsdom'`, `@vitejs/plugin-react`),
// not replace it.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
  },
});
