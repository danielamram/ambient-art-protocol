import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sdk = (p: string) => fileURLToPath(new URL(`./packages/sdk/src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Let package tests import sibling workspace packages from source, no build step needed.
    alias: [
      { find: '@ambient/sdk/testing', replacement: sdk('testing/index.ts') },
      { find: '@ambient/sdk', replacement: sdk('index.ts') },
      // App state tests validate scene ids against the real manifest registry.
      {
        find: '@ambient/shaders',
        replacement: fileURLToPath(new URL('./packages/shaders/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    // App tests cover pure state modules only; DOM behavior is checked in a real browser.
    include: ['packages/*/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/web/src/state/**'],
    },
  },
});
