/**
 * Minimal end-to-end demo: mount a mock source, watch signals flow through the bus.
 * Run with `pnpm dev` from the repo root.
 */
import { mount } from '../src/index.js';
import { createMockSource } from '../src/testing/index.js';

const registry = await mount([createMockSource({ intervalMs: 250, seed: 42 })]);
const { bus } = registry;

const started = Date.now();
const stamp = () => `+${String(Date.now() - started).padStart(5, ' ')}ms`;

bus.stream$.subscribe((s) => {
  const { v: _v, sourceId, ts: _ts, type, ...fields } = s;
  console.log(stamp(), `[${sourceId}]`, type.padEnd(8), JSON.stringify(fields));
});

bus.throttled('pulse', 1000).subscribe((p) => {
  console.log(stamp(), '  throttled pulse ->', p.magnitude.toFixed(3));
});

setTimeout(async () => {
  await registry.dispose();
  console.log(stamp(), 'disposed; bye');
}, 3000);
