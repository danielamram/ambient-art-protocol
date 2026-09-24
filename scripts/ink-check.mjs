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
const output = resolve(root, 'artifacts/ink-v2');
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 650 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/__ink', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<body style="margin:0;background:#000"></body>',
    }),
  );
  await page.goto(`${base}/__ink`);
  const results = await page.evaluate(
    async ({ root }) => {
      const { CanvasRenderer, SignalToUniformMapper } = await import(
        `/@fs${root}packages/engine/src/index.ts`
      );
      const { chromaticInk } = await import(`/@fs${root}packages/shaders/src/index.ts`);
      // Expose the real shader's density in RGB so default-framebuffer readback works
      // on both float-target and 8-bit-target devices. Simulation is unchanged.
      const densityTheme = {
        ...chromaticInk,
        fragment: chromaticInk.fragment.replace(
          'fragColor = vec4(col,density);',
          'fragColor=vec4(vec3(density),density);',
        ),
      };
      if (densityTheme.fragment === chromaticInk.fragment)
        throw Error('density probe not installed');
      const results = [];
      for (const ldr of [false, true]) {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:160px;height:128px';
        document.body.append(canvas);
        const gl = canvas.getContext('webgl2');
        if (ldr) {
          const get = gl.getExtension.bind(gl);
          gl.getExtension = (n) => (n.includes('color_buffer') ? null : get(n));
        }
        const renderer = new CanvasRenderer({ canvas, manifest: densityTheme, maxPixelRatio: 1 });
        renderer.setPost({ enabled: false });
        const mapper = new SignalToUniformMapper();
        mapper.setResolution(canvas.width, canvas.height);
        const state = mapper.snapshot();
        state.u_time = 12;
        const draw = (p = [0.5, 0.5, 0], dt = 1 / 30) => {
          state.u_dt = dt;
          renderer.setArt(0.45, p);
          renderer.render(state, 2);
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          if (gl.getError() !== gl.NO_ERROR) throw Error('GL error');
          let sum = 0;
          for (let i = 0; i < pixels.length; i += 4) sum += pixels[i];
          const at = (x, y) =>
            pixels[
              (Math.floor((1 - y) * (canvas.height - 1)) * canvas.width +
                Math.floor(x * (canvas.width - 1))) *
                4
            ];
          return {
            sum,
            center: at(0.5, 0.5),
            upper: at(0.3, 0.25),
            lower: at(0.3, 0.75),
            middle: at(0.5, 0.25),
          };
        };
        const check = (ok, message) => {
          if (!ok) throw Error(`${ldr ? 'LDR' : 'HDR'}: ${message}`);
        };
        check(draw().sum === 0, 'hover creates no pigment');
        for (let i = 0; i < 15; i++) draw([0.3, 0.25, 1]);
        const held = draw([0.3, 0.25, 1]);
        check(
          held.upper > 80 && held.upper > held.lower + 60,
          'hold paints beneath top-left-origin pointer',
        );
        const stroke = draw([0.7, 0.25, 1]);
        check(stroke.middle > 5, 'fast drag fills segment between samples');
        const released = draw([0.7, 0.25, 0]);
        check(released.sum > held.sum * 0.5, 'pigment survives release');
        const paused = draw([0.7, 0.25, 0], 0);
        check(paused.sum === released.sum, 'zero dt preserves density');
        let faded;
        for (let i = 0; i < 40; i++) faded = draw([0.7, 0.25, 0], 0.1);
        check(
          faded.sum < released.sum * 0.7,
          `released pigment decays: ${JSON.stringify({ released, faded })}`,
        );
        renderer.setShader(densityTheme);
        check(draw().sum === 0, 'scene reset clears pigment');
        // Paused relocation must not connect a stroke across the pause.
        draw([0.2, 0.25, 1], 0);
        draw([0.8, 0.25, 1], 0);
        const resumed = draw([0.8, 0.25, 1]);
        check(resumed.middle === 0, 'pause consumes pointer samples');
        results.push({ ldr, hdr: renderer.hdr, held, stroke, released, paused, faded });
        renderer.dispose();
        mapper.dispose();
        canvas.remove();
      }
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:100vw;height:100vh;display:block';
      document.body.append(canvas);
      const renderer = new CanvasRenderer({ canvas, manifest: chromaticInk, maxPixelRatio: 1 });
      const mapper = new SignalToUniformMapper();
      window.captureInk = (mood = 0, paint = false) => {
        const [w, h] = renderer.resize();
        mapper.setResolution(w, h);
        mapper.setTarget({ mood });
        mapper.settle();
        const state = mapper.snapshot();
        state.u_time = 12;
        state.u_dt = 1 / 30;
        renderer.setShader(chromaticInk);
        for (let i = 0; i < (paint ? 12 : 1); i++) {
          renderer.setArt(
            0.45,
            paint ? [0.25 + i * 0.035, 0.45 + Math.sin(i * 0.3) * 0.09, 1] : [0.5, 0.5, 0],
          );
          renderer.render(state, 2);
        }
      };
      return results;
    },
    { root },
  );
  for (const viewport of [
    { width: 800, height: 650 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const mood of [0, 0.5, 1]) {
      await page.evaluate((m) => window.captureInk(m, true), mood);
      await page.screenshot({ path: resolve(output, `${viewport.width}-palette-${mood}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', results, captures: output }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
