// Browser checks for the app experience: settings, saved looks, sharing, keyboard/focus,
// pointer lifecycle, source races, mobile layout and capture/legacy URLs.
// Separate from visual-check.mjs, which stays the shader/GPU gate.
//
// No third-party network: every non-loopback request is aborted, and source races use routed
// fakes for the Wikimedia stream. Render time is controlled like visual-check.mjs.
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
  logLevel: 'error',
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
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
const output = resolve(root, 'artifacts/app-check');
await mkdir(output, { recursive: true });

const passed = [];
const pageErrors = [];
// Expected noise: aborted feeds log their failure, blocked requests log a network error.
const EXPECTED_CONSOLE = [/\[ambient\] source/, /Failed to load resource/, /net::ERR_/];

/** A fresh browser context (clean storage) with controlled rAF and no outside network. */
async function open(path = '/', options = {}, init) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 850 },
    ...options,
  });
  await context.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${path}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !EXPECTED_CONSOLE.some((r) => r.test(m.text()))) {
      pageErrors.push(`${path}: ${m.text()}`);
    }
  });
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
  if (init) await page.addInitScript(init);
  if (path !== null) await go(page, path);
  return { context, page };
}
/** rAF is stubbed, so waitForFunction must poll on an interval instead of on animation frames. */
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { polling: 50 });
async function go(page, path) {
  await page.goto(`${base}${path}`);
  await page.locator('h1').waitFor({ state: 'attached' });
  await until(page, () => window.__aapStage !== undefined);
}
async function step(name, fn) {
  await fn();
  passed.push(name);
  console.log(`  ✓ ${name}`);
}

const tune = (page) => page.getByRole('button', { name: 'Tune artwork' });
const openPanel = async (page) => {
  if (!(await page.locator('#tuning').isVisible())) await tune(page).click();
  await page.locator('#tuning').waitFor();
};
const pressed = (page, name) =>
  page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed');
const slider = (page, label) => page.locator('label.slider', { hasText: label });
const sliderText = async (page, label) =>
  (await slider(page, label).locator('output').textContent()) ?? '';
const setSlider = async (page, label, key) => {
  await slider(page, label).locator('input').focus();
  await page.keyboard.press(key);
};
const liveLabel = (page) => page.locator('.live-label');
const stage = (page, fn, arg) => page.evaluate(fn, arg);
const notice = (page) => page.locator('.notice-region');
const saveLook = async (page, name) => {
  await page.getByRole('button', { name: 'Save look' }).click();
  await page.getByLabel('Name this look').fill(name);
  await page.keyboard.press('Enter');
  await notice(page).getByText('Look saved.').waitFor();
};
const countPulses = (page) =>
  stage(page, () => {
    window.__pulses = 0;
    window.__aapStage.bus.on('pulse').subscribe(() => {
      window.__pulses += 1;
    });
  });
const pulses = (page) => page.evaluate(() => window.__pulses);

try {
  console.log('app-check');

  await step('fresh visit with empty storage loads defaults without writing', async () => {
    const { context, page } = await open('/');
    assert.equal(await page.locator('h1').textContent(), 'Living Filaments');
    await openPanel(page);
    assert.equal(await pressed(page, 'Glacier'), 'true');
    assert.equal(await sliderText(page, 'Form'), '45%');
    assert.equal(await sliderText(page, 'Motion'), '45%');
    assert.match(await sliderText(page, 'Glow'), /scene default/);
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => localStorage.getItem('aap:last-look:v1')), null);
    await page.screenshot({ path: resolve(output, 'panel-desktop.png') });
    await context.close();
  });

  await step(
    'save a named look, reload, and restore it; rename, update, delete + undo',
    async () => {
      const { context, page } = await open('/');
      await openPanel(page);
      await page.getByRole('button', { name: 'Iris', exact: true }).click();
      await setSlider(page, 'Form', 'Home');
      await saveLook(page, '  Night   study ');
      await page.waitForTimeout(500);
      await page.reload();
      await until(page, () => window.__aapStage !== undefined);
      await openPanel(page);
      // The last look is restored on reload.
      assert.equal(await pressed(page, 'Iris'), 'true');
      assert.equal(await sliderText(page, 'Form'), '0%');
      await page.getByRole('button', { name: 'Glacier', exact: true }).click();
      await setSlider(page, 'Form', 'End');
      const row = page.locator('.look', { hasText: 'Night study' });
      await row.locator('.look-load').click();
      assert.equal(await pressed(page, 'Iris'), 'true');
      assert.equal(await sliderText(page, 'Form'), '0%');
      // Modify, then update the stored version explicitly.
      await setSlider(page, 'Motion', 'End');
      await row.getByText('modified').waitFor();
      await row.getByRole('button', { name: 'Update', exact: true }).click();
      assert.equal(await row.getByText('modified').count(), 0);
      // Rename; markup stays text.
      await row.getByRole('button', { name: 'Options for Night study' }).click();
      await row.getByRole('button', { name: 'Rename' }).click();
      await row.getByLabel('Rename').fill('<b>Dawn</b>');
      await page.keyboard.press('Enter');
      const renamed = page.locator('.look', { hasText: '<b>Dawn</b>' });
      await renamed.waitFor();
      assert.equal(await page.locator('.look-name b').count(), 0);
      // Delete with Undo.
      await renamed.getByRole('button', { name: /Options for/ }).click();
      await renamed.getByRole('button', { name: 'Delete' }).click();
      assert.equal(await page.locator('.look').count(), 0);
      await notice(page).getByRole('button', { name: 'Undo' }).click();
      await page.locator('.look', { hasText: '<b>Dawn</b>' }).waitFor();
      const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('aap:saved-looks:v1') ?? '{}'),
      );
      assert.equal(stored.looks.length, 1);
      assert.equal(stored.looks[0].settings.motion, 1);
      await page.screenshot({ path: resolve(output, 'saved-looks.png') });
      await context.close();
    },
  );

  await step('share copies a clean link that restores settings in a clean context', async () => {
    const { context, page } = await open(
      '/?scene=chromatic-ink&debug=1',
      { permissions: ['clipboard-read', 'clipboard-write'] },
      () => {
        // Exercise the clipboard path deterministically, whatever this Chromium offers.
        Object.defineProperty(Navigator.prototype, 'share', { value: undefined });
      },
    );
    await openPanel(page);
    await page.getByRole('button', { name: 'Ember', exact: true }).click();
    await setSlider(page, 'Glow', 'Home');
    await setSlider(page, 'Motion', 'Home');
    await page.getByRole('button', { name: 'Share these settings' }).click();
    await notice(page).getByText('Link copied.').waitFor();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(
      url,
      `${base}/#look=1&scene=chromatic-ink&palette=ember&form=0.45&motion=0&glow=0`,
    );
    const clean = await open(null);
    await go(clean.page, url.slice(base.length));
    await openPanel(clean.page);
    assert.equal(await clean.page.locator('h1').textContent(), 'Chromatic Ink');
    assert.equal(await pressed(clean.page, 'Ember'), 'true');
    assert.equal(await sliderText(clean.page, 'Motion'), '0%');
    // An explicit glow of 0 is not "scene default".
    assert.equal(await sliderText(clean.page, 'Glow'), '0%');
    assert.equal(await stage(clean.page, () => window.__aapStage.post.bloom), 0);
    // Opening a link never starts a live source.
    assert.equal(await liveLabel(clean.page).textContent(), 'Autonomous');
    await clean.context.close();
    await context.close();
  });

  await step(
    'native share cancel is quiet; missing clipboard shows a selectable link',
    async () => {
      const cancel = await open('/', {}, () => {
        Object.defineProperty(Navigator.prototype, 'share', {
          value: () => Promise.reject(new DOMException('dismissed', 'AbortError')),
        });
      });
      await openPanel(cancel.page);
      await cancel.page.getByRole('button', { name: 'Share these settings' }).click();
      await cancel.page.waitForTimeout(200);
      assert.equal(await notice(cancel.page).textContent(), '');
      assert.equal(await cancel.page.locator('.manual-copy').count(), 0);
      assert.equal(await cancel.page.locator('[role=alert]').count(), 0);
      await cancel.context.close();

      const manual = await open('/', {}, () => {
        Object.defineProperty(Navigator.prototype, 'share', { value: undefined });
        Object.defineProperty(Navigator.prototype, 'clipboard', { value: undefined });
      });
      await openPanel(manual.page);
      await manual.page.getByRole('button', { name: 'Share these settings' }).click();
      const field = manual.page.locator('.manual-copy input');
      await field.waitFor();
      assert.match(await field.inputValue(), /#look=1&scene=living-filaments/);
      assert.equal(await field.getAttribute('readonly'), '');
      assert.equal(await notice(manual.page).getByText('Link copied.').count(), 0);
      await manual.page.screenshot({ path: resolve(output, 'share-fallback.png') });
      await manual.context.close();
    },
  );

  await step('an invalid link recovers to defaults with readable feedback', async () => {
    const { context, page } = await open('/');
    await page.evaluate(() =>
      localStorage.setItem(
        'aap:last-look:v1',
        JSON.stringify({
          version: 1,
          scene: 'aurora-drift',
          palette: 'iris',
          form: 0,
          motion: 0,
          glow: null,
        }),
      ),
    );
    await go(page, '/#look=1&scene=%3Cscript%3E&palette=iris&form=0&motion=0&glow=0');
    await notice(page)
      .getByText(/could not be read/)
      .waitFor();
    assert.equal(await page.locator('h1').textContent(), 'Living Filaments');
    await openPanel(page);
    assert.equal(await pressed(page, 'Glacier'), 'true');
    assert.equal(await page.locator('script', { hasText: 'alert' }).count(), 0);
    assert.equal(await page.locator('[role=alert]').count(), 0);
    // The stored look was not overwritten by the fallback.
    await page.waitForTimeout(600);
    assert.match(
      (await page.evaluate(() => localStorage.getItem('aap:last-look:v1'))) ?? '',
      /aurora-drift/,
    );
    await context.close();
  });

  await step('a pasted look link applies once via hashchange; Back leaves it alone', async () => {
    const { context, page } = await open('/');
    await page.evaluate(() => {
      location.hash = 'look=1&scene=resonant-silk&palette=iris&form=0.2&motion=0.3&glow=default';
    });
    await notice(page).getByText('Opened a shared look.').waitFor();
    assert.equal(await page.locator('h1').textContent(), 'Resonant Silk');
    assert.equal(await page.evaluate(() => location.hash.includes('resonant-silk')), true);
    await page.goBack();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('h1').textContent(), 'Resonant Silk');
    await context.close();
  });

  await step('scene changes and saved-look loads preserve pause', async () => {
    const { context, page } = await open('/');
    await openPanel(page);
    await saveLook(page, 'Silk');
    await page.getByRole('button', { name: 'Pause animation' }).click();
    await page.locator('#tuning select').first().selectOption('chromatic-ink');
    assert.equal(await page.locator('h1').textContent(), 'Chromatic Ink');
    assert.equal(await page.getByRole('button', { name: 'Play animation' }).count(), 1);
    assert.equal(await stage(page, () => window.__aapStage.clock.paused), true);
    await page.locator('.look', { hasText: 'Silk' }).locator('.look-load').click();
    assert.equal(await page.locator('h1').textContent(), 'Living Filaments');
    assert.equal(await stage(page, () => window.__aapStage.clock.paused), true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('3');
    assert.equal(await page.locator('h1').textContent(), 'Resonant Silk');
    assert.equal(await stage(page, () => window.__aapStage.clock.paused), true);
    await context.close();
  });

  await step('reset lighting restores the effective scene default and glow semantics', async () => {
    const { context, page } = await open('/');
    await openPanel(page);
    const initial = await stage(page, () => window.__aapStage.post.bloom);
    await setSlider(page, 'Glow', 'End');
    assert.equal(await sliderText(page, 'Glow'), '100%');
    assert.equal(await stage(page, () => window.__aapStage.post.bloom), 1);
    await page.getByText('Studio settings').click();
    await page.getByRole('button', { name: 'Reset scene lighting' }).click();
    assert.match(await sliderText(page, 'Glow'), /scene default/);
    assert.equal(await stage(page, () => window.__aapStage.post.bloom), initial);
    // Fresh scene selection also returns to that scene's own lighting.
    await setSlider(page, 'Glow', 'End');
    await page.locator('#tuning select').first().selectOption('resonant-silk');
    assert.match(await sliderText(page, 'Glow'), /scene default/);
    await context.close();
  });

  await step(
    'keyboard: panel focus, Escape, held keys, and no shortcuts while typing',
    async () => {
      const { context, page } = await open('/');
      await countPulses(page);
      await tune(page).focus();
      await page.keyboard.press('Enter');
      await page.locator('#tuning').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'tuning-heading');
      assert.equal(await tune(page).getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#tuning').isVisible(), false);
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        'Tune artwork',
      );
      // Escape with nothing open leaves focus where it is.
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
      // Hidden controls are not focusable.
      assert.equal(await page.locator('#tuning select').first().isVisible(), false);
      // H toggles the panel; typing in the name field triggers no shortcuts.
      await page.keyboard.press('h');
      await page.getByRole('button', { name: 'Save look' }).click();
      const field = page.getByLabel('Name this look');
      await field.fill('');
      await field.pressSequentially('2 ph');
      assert.equal(await page.locator('h1').textContent(), 'Living Filaments');
      assert.equal(await stage(page, () => window.__aapStage.clock.paused), false);
      assert.equal(await page.locator('#tuning').isVisible(), true);
      assert.equal(await pulses(page), 0);
      // Escape in the name form cancels the form, not the panel.
      await page.keyboard.press('Escape');
      assert.equal(await page.getByLabel('Name this look').count(), 0);
      assert.equal(await page.locator('#tuning').isVisible(), true);
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.activeElement?.blur());
      // A held P toggles pause once; a held Space sends one pulse.
      await page.keyboard.down('p');
      await page.keyboard.down('p');
      await page.keyboard.up('p');
      assert.equal(await stage(page, () => window.__aapStage.clock.paused), true);
      await page.keyboard.down(' ');
      await page.keyboard.down(' ');
      await page.keyboard.up(' ');
      assert.equal(await pulses(page), 1);
      await page.keyboard.press('Control+2');
      assert.equal(await page.locator('h1').textContent(), 'Living Filaments');
      await context.close();
    },
  );

  await step(
    'pointer: release pulses once; cancel and blur end the gesture without a pulse',
    async () => {
      const { context, page } = await open('/');
      await countPulses(page);
      const active = () => stage(page, () => window.__aapStage.pointerActive);
      await page.mouse.move(600, 400);
      await page.mouse.down();
      assert.equal(await active(), true);
      await page.mouse.up();
      assert.equal(await pulses(page), 1);
      await page.mouse.down();
      await page.evaluate(() =>
        document
          .querySelector('canvas')
          .dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })),
      );
      assert.equal(await active(), false);
      await page.mouse.up();
      assert.equal(await pulses(page), 1);
      await page.mouse.down();
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await active(), false);
      await page.mouse.up();
      assert.equal(await pulses(page), 1);
      await context.close();
    },
  );

  await step(
    'sources: failure is recoverable, pending starts lose to looks, races settle',
    async () => {
      const { context, page } = await open('/');
      let release = () => undefined;
      let mode = 'fail';
      await context.route('**/stream.wikimedia.org/**', async (route) => {
        if (mode === 'hang') await new Promise((r) => (release = r));
        await route.abort();
      });
      const status = (id) => stage(page, (i) => window.__aapStage.sourceStatus(i), id);
      await openPanel(page);
      await saveLook(page, 'Quiet');
      const picker = page.getByLabel('Driven by');

      // A failed start: truthful label, Retry and Autonomous.
      await picker.selectOption('wikipedia-edits');
      await page.getByText('Source unavailable. The artwork keeps running on its own.').waitFor();
      assert.equal(await liveLabel(page).textContent(), 'Source unavailable');
      await page.screenshot({ path: resolve(output, 'source-unavailable.png') });
      await page.getByRole('button', { name: 'Retry' }).click();
      await page.getByText('Source unavailable. The artwork keeps running on its own.').waitFor();
      await page.getByRole('button', { name: 'Autonomous', exact: true }).click();
      await until(page, () => document.querySelector('.live-label')?.textContent === 'Autonomous');

      // The simulated source goes live; loading a look returns to Autonomous and stays there.
      await picker.selectOption('mock');
      await until(page, () => document.querySelector('.live-label')?.textContent === 'Live signal');
      await page.locator('.look', { hasText: 'Quiet' }).locator('.look-load').click();
      assert.equal(await liveLabel(page).textContent(), 'Autonomous');
      await notice(page)
        .getByText(/back to Autonomous/)
        .waitFor();
      await page.waitForTimeout(300);
      assert.equal(await status('mock'), 'stopped');
      assert.equal(await picker.inputValue(), '');

      // A pending connection loses to a loaded look, even when it settles later.
      mode = 'hang';
      await picker.selectOption('wikipedia-edits');
      assert.equal(await liveLabel(page).textContent(), 'Connecting');
      await page.locator('.look', { hasText: 'Quiet' }).locator('.look-load').click();
      assert.equal(await liveLabel(page).textContent(), 'Autonomous');
      // The abort ends the connection attempt itself; it does not wait for the stream to settle.
      await until(page, () => window.__aapStage.sourceStatus('wikipedia-edits') === 'stopped');
      release();
      await page.waitForTimeout(300);
      assert.equal(await liveLabel(page).textContent(), 'Autonomous');
      assert.equal(await status('wikipedia-edits'), 'stopped');

      // Rapid A -> B -> Autonomous settles with nothing running and no stale status.
      mode = 'hang';
      await picker.selectOption('wikipedia-edits');
      await picker.selectOption('mock');
      await picker.selectOption('');
      release();
      await page.waitForTimeout(400);
      assert.equal(await liveLabel(page).textContent(), 'Autonomous');
      assert.notEqual(await status('wikipedia-edits'), 'running');
      assert.notEqual(await status('mock'), 'running');
      assert.equal(await page.getByText('Source unavailable.').count(), 0);
      await context.close();
    },
  );

  for (const width of [390, 320]) {
    await step(
      `mobile ${width}px: no horizontal overflow, panel scrolls, gestures stay out of the canvas`,
      async () => {
        const { context, page } = await open('/', {
          viewport: { width, height: 640 },
          hasTouch: true,
          isMobile: true,
          deviceScaleFactor: 2,
        });
        await countPulses(page);
        await page.evaluate(() => {
          window.__canvasDowns = 0;
          document.querySelector('canvas').addEventListener('pointerdown', () => {
            window.__canvasDowns += 1;
          });
        });
        for (const name of ['Tune artwork', 'Pause animation']) {
          const box = await page.getByRole('button', { name }).boundingBox();
          assert.ok(box && box.width >= 44 && box.height >= 44, `${name} is ${box?.width}px`);
        }
        await openPanel(page);
        await page.getByText('Studio settings').click();
        const overflow = await page.evaluate(() => {
          const bad = [];
          for (const el of document.querySelectorAll('#tuning *, .chrome *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.right > innerWidth + 0.5 || r.left < -0.5) bad.push(el.className || el.tagName);
          }
          return { bad, scroll: document.documentElement.scrollWidth - innerWidth };
        });
        assert.deepEqual(overflow.bad, []);
        assert.ok(overflow.scroll <= 0);
        const scrolled = await page.evaluate(() => {
          const p = document.getElementById('tuning');
          p.scrollTop = 400;
          return { top: p.scrollTop, scrollable: p.scrollHeight > p.clientHeight };
        });
        assert.ok(scrolled.scrollable && scrolled.top > 0, 'panel scrolls internally');
        const panel = await page.locator('#tuning').boundingBox();
        await page.touchscreen.tap(panel.x + panel.width / 2, panel.y + 20);
        await page.mouse.wheel(0, 300);
        assert.equal(await page.evaluate(() => window.__canvasDowns), 0);
        assert.equal(await pulses(page), 0);
        await page.evaluate(() => {
          document.getElementById('tuning').scrollTop = 0;
        });
        await page.screenshot({ path: resolve(output, `panel-${width}.png`) });
        await context.close();
      },
    );
  }

  await step(
    'reduced motion, and unsupported fullscreen is hidden rather than promised',
    async () => {
      const { context, page } = await open('/', { reducedMotion: 'reduce' }, () => {
        Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
      });
      assert.equal(await stage(page, () => window.__aapStage.clock.reduced), true);
      const duration = await page.evaluate(
        () => getComputedStyle(document.querySelector('.chrome')).transitionDuration,
      );
      assert.equal(duration, '0s');
      assert.equal(await page.getByRole('button', { name: 'Fullscreen' }).count(), 0);
      await page.keyboard.press('f');
      assert.equal(await page.locator('[role=alert]').count(), 0);
      await openPanel(page);
      await page.getByText('Studio settings').click();
      assert.equal(await page.getByText('F fullscreen').count(), 0);
      await context.close();
    },
  );

  await step('diagnostics show existing measurements and copy a local report', async () => {
    const { context, page } = await open('/', {
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await page.waitForTimeout(100);
    for (const t of [1000, 1600, 2200]) await page.evaluate((x) => window.advanceArt(x), t);
    await openPanel(page);
    await page.getByText('Studio settings').click();
    await page.locator('.diagnostics dd', { hasText: /fps$/ }).waitFor();
    await page.getByRole('button', { name: 'Copy diagnostics' }).click();
    await notice(page).getByText('Diagnostics copied.').waitFor();
    const report = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    assert.equal(report.artwork.scene, 'living-filaments');
    assert.equal(typeof report.rendering.fps, 'number');
    assert.equal(typeof report.rendering.floatRenderTarget, 'boolean');
    assert.equal(report.app.commit, 'unknown');
    assert.match(report.limits, /p95/);
    await context.close();
  });

  await step('capture and legacy URLs keep their behavior and ignore saved state', async () => {
    const { context, page } = await open('/');
    await page.evaluate(() =>
      localStorage.setItem(
        'aap:last-look:v1',
        JSON.stringify({
          version: 1,
          scene: 'aurora-drift',
          palette: 'iris',
          form: 0,
          motion: 0,
          glow: 0,
        }),
      ),
    );
    await go(
      page,
      '/?capture&scene=chromatic-ink&time=12#look=1&scene=resonant-silk&palette=iris&form=0&motion=0&glow=0',
    );
    assert.equal(await page.locator('h1').textContent(), 'Chromatic Ink');
    assert.equal(await stage(page, () => window.__aapStage.captureMode), true);
    assert.equal(await page.locator('.notice-region').count(), 0);
    assert.equal(await page.locator('header.chrome').isVisible(), false);
    assert.equal(await page.locator('#tuning').isVisible(), false);
    assert.equal(await page.getByLabel('Driven by').isDisabled(), true);
    await go(page, '/?scene=resonant-silk');
    assert.equal(await page.locator('h1').textContent(), 'Resonant Silk');
    await openPanel(page);
    assert.equal(await pressed(page, 'Glacier'), 'true');
    await go(page, '/');
    assert.equal(await page.locator('h1').textContent(), 'Aurora Drift');
    await context.close();
  });

  assert.deepEqual(pageErrors, []);
  console.log(
    JSON.stringify({ status: 'passed', checks: passed.length, captures: output }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
}
