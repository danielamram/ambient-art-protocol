import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

export default defineConfig({
  // Relative asset URLs so the build also works when served from a sub-path.
  base: './',
  plugins: [react()],
  resolve: {
    // Bundle workspace packages from source so no prior tsc build is needed.
    alias: [
      { find: '@ambient/sdk/testing', replacement: pkg('sdk/src/testing/index.ts') },
      { find: '@ambient/sdk', replacement: pkg('sdk/src/index.ts') },
      { find: '@ambient/engine', replacement: pkg('engine/src/index.ts') },
      { find: '@ambient/shaders', replacement: pkg('shaders/src/index.ts') },
    ],
  },
  build: { target: 'es2022', sourcemap: true },
});
