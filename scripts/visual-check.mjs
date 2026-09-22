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
const output = resolve(root, 'artifacts/visual-check');
await mkdir(output, { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Control render time, rather than using arbitrary sleeps or live feeds in captures.
  await page.addInitScript(() => {
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (cb) => {
      callbacks.set(++id, cb);
      return id;
    };
    window.cancelAnimationFrame = (i) => callbacks.delete(i);
    window.advanceArt = (time) => {
      const frame = [...callbacks.values()];
      callbacks.clear();
      for (const cb of frame) cb(time);
    };
  });
  await page.goto(base);
  await page.getByRole('heading', { name: 'Living Filaments' }).waitFor();
  let time = 1000;
  const frame = async () => {
    // Let ResizeObserver and React commit before advancing the controlled render clock.
    await page.waitForTimeout(100);
    time += 2000;
    await page.evaluate((t) => window.advanceArt(t), time);
  };
  await frame();
  await frame();
  for (const [index, name] of ['living-filaments', 'chromatic-ink', 'resonant-silk'].entries()) {
    await page.locator('.collection button').nth(index).click();
    await frame();
    await frame();
    assert.equal(await page.locator('[role=alert]').count(), 0);
    await page.screenshot({ path: resolve(output, `${name}.png`) });
  }
  await page.locator('.collection button').first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await frame();
  await frame();
  await page.screenshot({ path: resolve(output, 'portrait.png') });
  await page.getByRole('button', { name: 'Tune artwork' }).click();
  await page.getByRole('button', { name: 'Ember', exact: true }).click();
  await frame();
  await page.screenshot({ path: resolve(output, 'controls.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#tuning').isVisible(), false);
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await frame();
  await page.setViewportSize({ width: 430, height: 850 });
  await frame();
  assert.equal(await page.getByRole('button', { name: 'Play animation', exact: true }).count(), 1);

  // Exercise the actual GPU compiler and renderer, including all legacy themes.
  await page.route('**/__gpu_check', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }),
  );
  await page.goto(`${base}/__gpu_check`);
  const gpu = await page.evaluate(
    async ({ root }) => {
      const { CanvasRenderer, SignalToUniformMapper } = await import(
        `/@fs${root}packages/engine/src/index.ts`
      );
      const { SHADER_MANIFESTS } = await import(`/@fs${root}packages/shaders/src/index.ts`);
      const results = [];
      for (const forceLdr of [false, true]) {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:256px;height:192px';
        document.body.append(canvas);
        const gl = canvas.getContext('webgl2');
        if (!gl) throw new Error('WebGL2 unavailable');
        if (forceLdr) {
          const get = gl.getExtension.bind(gl);
          gl.getExtension = (name) => (name.includes('color_buffer') ? null : get(name));
        }
        const renderer = new CanvasRenderer({
          canvas,
          manifest: SHADER_MANIFESTS[0],
          maxPixelRatio: 1,
        });
        const mapper = new SignalToUniformMapper();
        mapper.setTarget({ mood: 0, turbulence: 0.25 });
        mapper.settle();
        mapper.tick(1 / 60);
        const sample = () => {
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let bright = 0;
          let hash = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 40) bright++;
            hash = (hash + pixels[i] * (i + 1) + pixels[i + 1] * 3) % 2147483647;
          }
          return { bright, hash };
        };
        for (const theme of SHADER_MANIFESTS) {
          renderer.setShader(theme);
          for (const quality of [1, 0]) {
            renderer.setShaderQuality(quality);
            renderer.render(mapper.snapshot(), 2);
            const before = sample();
            if (before.bright < 20) throw new Error(`${theme.id} rendered almost black`);
            renderer.setArt(0.8, [0.64, 0.5, 1]);
            mapper.pushPulse({ magnitude: 0.8, location: { x: 0.64, y: 0.5 } });
            mapper.tick(1 / 30);
            renderer.render(mapper.snapshot(), 2);
            const after = sample();
            if (before.hash === after.hash) throw new Error(`${theme.id} did not respond`);
            const error = gl.getError();
            if (error !== gl.NO_ERROR) throw new Error(`${theme.id}: GL error ${error}`);
            renderer.setRenderScale(0.5);
            renderer.render(mapper.snapshot(), 2);
            renderer.setRenderScale(1);
            renderer.render(mapper.snapshot(), 2);
            if (gl.getError() !== gl.NO_ERROR) throw new Error(`${theme.id}: resize GL error`);
            results.push({ theme: theme.id, quality, hdr: renderer.hdr, bright: after.bright });
          }
        }
        const previous = renderer.manifest;
        let failed = false;
        try {
          renderer.setShader({ ...previous, fragment: 'invalid shader' });
        } catch {
          failed = true;
        }
        if (!failed || renderer.manifest !== previous)
          throw new Error('Failed shader replaced active scene');
        renderer.render(mapper.snapshot(), 2);
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) {
          await new Promise((resolve) => {
            canvas.addEventListener('webglcontextlost', resolve, { once: true });
            ext.loseContext();
          });
          await new Promise((resolve) => setTimeout(resolve, 50));
          await new Promise((resolve) => {
            canvas.addEventListener('webglcontextrestored', resolve, { once: true });
            ext.restoreContext();
          });
          renderer.render(mapper.snapshot(), 2);
          if (sample().bright < 20 || gl.getError() !== gl.NO_ERROR)
            throw new Error('Context recovery failed');
        }
        renderer.dispose();
        mapper.dispose();
        canvas.remove();
      }
      return results;
    },
    { root },
  );
  assert.equal(gpu.length, 24);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ status: 'passed', gpuCases: gpu.length, captures: output }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
}
