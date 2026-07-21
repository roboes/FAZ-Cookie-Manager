/**
 * JS unit test (jsdom) — guards PR #185: the `_fazInitDone` idempotency flag
 * that stops the DomReady bootstrap from running `_fazInit` twice.
 *
 * Cloudflare Rocket Loader (and some other script optimisers) can execute
 * `script.min.js` twice per page load — once synchronously (because
 * `data-cfasync="false"` opts it out of deferral) and again through their own
 * deferred queue. Without a guard the bootstrap ran `_fazInit` on each pass,
 * inserting a SECOND banner into the DOM; `_fazGetBanner()` uses
 * `querySelector` (first match), so clicking Reject hid banner #1 while banner
 * #2 stayed visible (issue #125 family — Cloudflare).
 *
 * The fix sets `window.fazcookie._fazInitDone = true` synchronously (before the
 * `await _fazInit()`) and short-circuits on the second run. `window.fazcookie`
 * persists across executions, so the flag survives.
 *
 * How this test exercises it WITHOUT a browser or the full banner template:
 * `_fazInit()` calls `_fazScheduleBannerWatchdog()` synchronously at its very
 * top (script.js), which calls `window.setTimeout(...)`. We spy on
 * `window.setTimeout` and fire the captured DomReady callback twice: the first
 * firing runs `_fazInit` and schedules ≥1 timer; the second firing must
 * short-circuit at the guard and schedule ZERO new timers. If the guard were
 * removed, the second firing would run `_fazInit` again and the timer count
 * would climb — so this test fails loudly on a regression.
 *
 * The bootstrap callback is captured (not run) by forcing document.readyState
 * to "loading" so `_fazDomReady` registers it via addEventListener, which the
 * harness intercepts.
 *
 * Run: node tests/unit/js/rocket-loader-double-init-guard.test.mjs
 */

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(HERE, '../../../frontend/js/script.js');

let passed = 0;
let failed = 0;
function eq(label, actual, expected) {
  if (actual === expected) {
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}`);
    console.log(`       expected: ${JSON.stringify(expected)}`);
    console.log(`       actual:   ${JSON.stringify(actual)}`);
  }
}
function ok(label, cond) {
  eq(label, !!cond, true);
}

async function run() {
  const code = readFileSync(SCRIPT_PATH, 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  const { window } = dom;

  // Minimal block-first store — enough for _fazInit's synchronous prologue to
  // run (watchdog + dead-cookie cleanup). No banner is in the DOM, so
  // _fazGetBanner() returns null and the async language-swap branch is skipped.
  window._fazConfig = {
    _block: '1',
    _categories: [{ slug: 'necessary', isNecessary: true }],
    _services: [],
    _providersToBlock: [],
    _userWhitelist: [],
    i18n: {},
  };
  window.fazcookie = { _fazGetFromStore: () => undefined };

  // Force "loading" so _fazDomReady takes the addEventListener branch instead of
  // calling the callback synchronously; the interceptor captures it unrun.
  Object.defineProperty(window.document, 'readyState', {
    get: () => 'loading',
    configurable: true,
  });
  let bootstrap = null;
  const realAdd = window.document.addEventListener.bind(window.document);
  window.document.addEventListener = (type, cb, ...rest) => {
    if (type === 'DOMContentLoaded') {
      bootstrap = cb;
      return undefined;
    }
    return realAdd(type, cb, ...rest);
  };

  // Spy on window.setTimeout — the observable proxy for "_fazInit ran". The
  // watchdog scheduled at the top of _fazInit calls window.setTimeout(...).
  let timerCount = 0;
  window.setTimeout = (/* fn, delay */) => {
    timerCount += 1;
    return 0;
  };

  // The bootstrap wraps `await _fazInit()` in try/catch and console.error's any
  // failure. With this minimal harness config _fazInit throws part-way through
  // its prologue (AFTER the watchdog timer is scheduled, which is all this test
  // observes), so silence the expected diagnostic to keep the output clean.
  window.console.error = () => {};

  window.eval(code);
  window.document.addEventListener = realAdd;

  ok('DomReady bootstrap callback was captured', typeof bootstrap === 'function');

  // Ignore any timers scheduled by top-level eval; measure only the bootstrap.
  timerCount = 0;

  // First execution — the real init pass.
  await bootstrap();
  const afterFirst = timerCount;
  ok('first init scheduled at least one timer (watchdog ran)', afterFirst >= 1);
  eq('guard flag is armed after the first init', window.fazcookie._fazInitDone, true);

  // Second execution — simulates Rocket Loader's duplicate run. The guard must
  // short-circuit before _fazInit, so NO new timers are scheduled.
  await bootstrap();
  const afterSecond = timerCount;
  eq('second init is a no-op (no new timers scheduled)', afterSecond, afterFirst);

  console.log(`\n  rocket-loader-double-init-guard: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
