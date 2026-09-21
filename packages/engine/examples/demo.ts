/**
 * Mock source -> bus -> SignalToUniformMapper -> uniform snapshots on stdout.
 * Run with `pnpm dev:engine` from the repo root. Shows targets jumping and current gliding.
 */
import { mount } from '@ambient/sdk';
import { createMockSource } from '@ambient/sdk/testing';
import { FrameLoop, SignalToUniformMapper } from '../src/index.js';

const registry = await mount([createMockSource({ intervalMs: 400, seed: 7 })]);
const mapper = new SignalToUniformMapper({ moodTau: 1.2, turbulenceTau: 0.8 }).attach(registry.bus);
mapper.setResolution(1280, 720);

const f = (n: number) => n.toFixed(3);
let frame = 0;
const loop = new FrameLoop((dt) => {
  mapper.tick(dt);
  frame += 1;
  if (frame % 10 !== 0) return;
  const s = mapper.snapshot();
  const t = mapper.targets();
  console.log(
    `t=${f(s.u_time)}s  mood ${f(s.u_mood)}->${f(t.mood)}  turb ${f(s.u_turbulence)}->${f(t.turbulence)}` +
      `  current [${s.u_current.map(f).join(', ')}]  pulse ${f(s.u_pulse)} (${mapper.pulses.size} live)`,
  );
}).start();

setTimeout(async () => {
  loop.stop();
  mapper.dispose();
  await registry.dispose();
  console.log('disposed; bye');
}, 3000);
