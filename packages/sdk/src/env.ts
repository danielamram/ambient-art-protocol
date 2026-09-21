/**
 * Isomorphic "are we in development?" check.
 * Node: reads NODE_ENV. Vite: statically replaced at build time.
 * Bare browser with no bundler: `process` is undefined, so we default to dev (validate).
 */
export function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return true;
  }
}
