import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(requireWeb.resolve('vite'));
const server = await createServer({
  root: resolve(root, 'apps/web'),
  configFile: resolve(root, 'apps/web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const address = server.httpServer.address();
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const output = resolve(root, 'artifacts/event-filaments');
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/__filaments', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<body style="margin:0;background:#000"><canvas style="width:100vw;height:100vh;display:block"></canvas></body>',
    }),
  );
  await page.goto(`${base}/__filaments`);
  await page.evaluate(
    async ({ root }) => {
      const { CanvasRenderer, SignalToUniformMapper } = await import(
        `/@fs${root}packages/engine/src/index.ts`
      );
      const { livingFilaments } = await import(`/@fs${root}packages/shaders/src/index.ts`);
      const canvas = document.querySelector('canvas');
      const renderer = new CanvasRenderer({ canvas, manifest: livingFilaments, maxPixelRatio: 1 });
      const mapper = new SignalToUniformMapper();
      mapper.setTarget({ mood: 0, turbulence: 0.2 });
      mapper.settle();
      window.study = { renderer, mapper };
      window.draw = (time, form = 0.45, mood = 0, pointer = [0.5, 0.5, 0], dt = 1 / 60) => {
        const [w, h] = renderer.resize();
        mapper.setResolution(w, h);
        mapper.setTarget({ mood });
        mapper.settle();
        const state = mapper.snapshot();
        state.u_time = time;
        state.u_dt = dt;
        renderer.setArt(form, pointer);
        renderer.render(state, 2);
        const gl = canvas.getContext('webgl2');
        const bytes = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        let lit = 0,
          clipped = 0,
          edge = 0,
          hash = 0;
        for (let i = 0; i < bytes.length; i += 4) {
          const bright = Math.max(bytes[i], bytes[i + 1], bytes[i + 2]);
          const x = (i / 4) % canvas.width,
            y = Math.floor(i / 4 / canvas.width);
          if (bright > 60) {
            lit++;
            if (x < 3 || y < 3 || x > canvas.width - 4 || y > canvas.height - 4) edge++;
          }
          if (Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) > 245) clipped++;
          hash = (hash + bytes[i] * (i + 1) + bytes[i + 1] * 3) % 2147483647;
        }
        if (gl.getError() !== gl.NO_ERROR) throw Error('WebGL error');
        return { lit, clipped, edge, hash };
      };
    },
    { root },
  );
  await page.evaluate(
    async ({ root }) => {
      const { DataSignalBus } = await import(`/@fs${root}packages/sdk/src/index.ts`);
      const bus = new DataSignalBus();
      window.study.mapper.attach(bus);
      window.feed = bus;
      window.resetEvents = () => {
        window.study.mapper.dispose();
        window.study.mapper.attach(bus);
      };
      window.event = (magnitude, x = 0.35, y = 0.4) =>
        bus.emitPayload({ type: 'pulse', magnitude, location: { x, y } }, 'configured-test-source');
    },
    { root },
  );
  const reports = [];
  for (const viewport of [
    { width: 1000, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const quiet = await page.evaluate(() => {
      window.resetEvents();
      window.study.mapper.tick(0);
      return window.draw(12);
    });
    await page.screenshot({ path: resolve(output, `${viewport.width}-quiet.png`) });
    const still = await page.evaluate(() => {
      window.study.mapper.tick(1);
      return window.draw(12);
    });
    assert.equal(
      quiet.hash,
      still.hash,
      'no event-driven changes without events at fixed art time',
    );
    const single = await page.evaluate(() => {
      window.event(0.8);
      window.study.mapper.tick(0.1);
      return window.draw(12);
    });
    await page.screenshot({ path: resolve(output, `${viewport.width}-pulse.png`) });
    assert.notEqual(single.hash, quiet.hash, 'bus event causes visible response without pointer');
    const travel = await page.evaluate(() => {
      window.study.mapper.tick(0.4);
      return window.draw(12);
    });
    assert.notEqual(travel.hash, single.hash, 'pulse age moves the response');
    const frozen = await page.evaluate(() => {
      window.study.mapper.tick(0);
      return window.draw(12, 0.45, 0, [0.5, 0.5, 0], 0);
    });
    assert.equal(frozen.hash, travel.hash, 'pause freezes response');
    const weak = await page.evaluate(() => {
      window.resetEvents();
      window.event(0.15);
      window.study.mapper.tick(0.1);
      return window.draw(12);
    });
    assert.notEqual(weak.hash, single.hash, 'magnitude changes response');
    const location = await page.evaluate(() => {
      window.resetEvents();
      window.event(0.8, 0.8, 0.7);
      window.study.mapper.tick(0.1);
      return window.draw(12);
    });
    assert.notEqual(location.hash, single.hash, 'event location selects a different bundle');
    const burst = await page.evaluate(() => {
      window.resetEvents();
      for (let i = 0; i < 80; i++) window.event(0.8, (i % 7) / 7, (i % 5) / 5);
      window.study.mapper.tick(1);
      return { ...window.draw(12), activity: window.study.mapper.snapshot().u_activity };
    });
    await page.screenshot({ path: resolve(output, `${viewport.width}-burst.png`) });
    assert.ok(burst.activity > 0.7 && burst.activity <= 1, 'burst activity bounded');
    assert.equal(burst.edge, 0, 'burst composition fits');
    assert.ok(burst.clipped / Math.max(1, burst.lit) < 0.01, 'burst retains highlight detail');
    const memory = await page.evaluate(() => {
      window.study.mapper.tick(3);
      return { ...window.draw(12), pulses: window.study.mapper.pulses.size };
    });
    assert.equal(memory.pulses, 0);
    assert.notEqual(memory.hash, quiet.hash, 'shape remembers activity beyond the pulse ring');
    const recovered = await page.evaluate(() => {
      window.study.mapper.tick(240);
      return window.draw(12);
    });
    assert.equal(recovered.hash, quiet.hash, 'quiet state returns after events stop');
    reports.push({ viewport, quiet, single, travel, burst, memory, recovered });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', reports, captures: output }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
