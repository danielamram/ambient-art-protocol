import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };
// Only a commit the build environment reports; never a guess. Vercel sets VERCEL_GIT_COMMIT_SHA.
const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.AAP_COMMIT || null;

export default defineConfig({
  define: {
    __AAP_VERSION__: JSON.stringify(version),
    __AAP_COMMIT__: JSON.stringify(commit),
  },
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
      { find: '@ambient/sources', replacement: pkg('sources/src/index.ts') },
    ],
  },
  build: { target: 'es2022', sourcemap: true },
});
