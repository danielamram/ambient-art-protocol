import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sdk = (p: string) => fileURLToPath(new URL(`./packages/sdk/src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Let package tests import sibling workspace packages from source, no build step needed.
    alias: [
      { find: '@ambient/sdk/testing', replacement: sdk('testing/index.ts') },
      { find: '@ambient/sdk', replacement: sdk('index.ts') },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
    },
  },
});
