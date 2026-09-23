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
const output = resolve(root, 'artifacts/filaments-v2');
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
  const samples = [];
  for (const viewport of [
    { width: 1000, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const time of [0, 20, 45, 70, 90]) {
      const sample = await page.evaluate((t) => window.draw(t), time);
      assert.ok(sample.lit > 200, 'sculpture visible');
      assert.equal(sample.edge, 0, 'silhouette must fit');
      assert.ok(sample.clipped / Math.max(1, sample.lit) < 0.01, 'retain highlight detail');
      samples.push({ viewport, time, ...sample });
      await page.screenshot({ path: resolve(output, `${viewport.width}-${time}.png`) });
    }
  }
  assert.equal(new Set(samples.map((s) => s.hash)).size, 10, 'distinct phases');
  for (const mood of [0.5, 1]) {
    for (const form of [0, 1]) {
      const sample = await page.evaluate(({ mood, form }) => window.draw(20, form, mood), {
        mood,
        form,
      });
      assert.equal(sample.edge, 0, 'extreme controls remain framed');
      await page.screenshot({ path: resolve(output, `palette-${mood}-form-${form}.png`) });
    }
  }
  // Hold shader time fixed to isolate elastic memory from choreography.
  // The integration assertions do not need full geometry density. The full-detail
  // phases above and the separate 24-case harness cover shader quality variants.
  await page.evaluate(() => window.study.renderer.setShaderQuality(0));
  const result = await page.evaluate(() => {
    const baseline = window.draw(20);
    for (let i = 0; i < 30; i++) window.draw(20, 0.45, 0, [0.35 + i / 100, 0.5, 1]);
    const released = window.draw(20, 0.45, 0, [0.64, 0.5, 0]);
    const paused = window.draw(20, 0.45, 0, [0.64, 0.5, 0], 0);
    for (let i = 0; i < 100; i++) window.draw(20, 0.45, 0, [0.64, 0.5, 0], 0.1);
    const settled = window.draw(20);
    return { baseline, released, paused, settled };
  });
  assert.equal(result.released.edge, 0, 'release wake remains framed');
  assert.notEqual(result.baseline.hash, result.released.hash, 'release retains wake');
  assert.equal(result.released.hash, result.paused.hash, 'zero art dt freezes wake');
  assert.equal(result.baseline.hash, result.settled.hash, 'wake settles back to baseline');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { status: 'passed', phases: samples, gesture: result, captures: output },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server.close();
}
