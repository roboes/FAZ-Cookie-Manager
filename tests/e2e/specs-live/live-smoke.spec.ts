import { expect, test } from '@playwright/test';
import {
  NOTICE,
  TRACKER_COOKIE_RE,
  clickFirstVisible,
  getConsentCookie,
  parseConsentCookie,
} from './_live-helpers';

/**
 * Production-safe smoke suite for a LIVE WordPress site (e.g. fabiodalez.it).
 *
 * Run via `npm run test:live` (playwright.live.config.ts), which points
 * WP_BASE_URL at the live site. This file is DELIBERATELY self-contained and
 * READ-ONLY:
 *   - No admin login, no wp-cli, no REST writes, no plugin (de)activation.
 *   - No assertions about a specific banner styling / category set, so it
 *     passes against whatever banner the production site actually ships.
 * It checks only config-independent compliance invariants (the TF01–TF05
 * family) plus a fatal-error guard. Every test runs in its own fresh browser
 * context (Playwright's default `page` fixture), so consent state never leaks
 * between tests and real visitor data is never touched.
 */

test.describe('Live smoke — read-only compliance invariants', () => {
  test('LIVE-00: homepage loads without a PHP fatal error', async ({ page }) => {
    const resp = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(resp, 'no response from homepage').toBeTruthy();
    expect(resp!.status(), 'homepage HTTP status').toBeLessThan(400);
    const body = (await page.content()).toLowerCase();
    for (const marker of ['there has been a critical error', 'fatal error', 'parse error']) {
      expect(body, `homepage contains "${marker}"`).not.toContain(marker);
    }
  });

  test('LIVE-01: consent banner appears on a fresh visit', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // No consent cookie yet on a brand-new context.
    expect(await getConsentCookie(page.context())).toBeUndefined();
    await expect(page.locator(NOTICE)).toBeVisible({ timeout: 10_000 });
  });

  test('LIVE-02: no known trackers are set before consent (ePrivacy)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator(NOTICE)).toBeVisible({ timeout: 10_000 });
    // Give any (mis)behaving script a moment to drop a cookie.
    await page.waitForTimeout(1500);
    const cookies = await page.context().cookies();
    const trackers = cookies.filter((c) => TRACKER_COOKIE_RE.some((re) => re.test(c.name)));
    expect(
      trackers,
      `Trackers present before consent: ${JSON.stringify(trackers.map((c) => c.name))}`,
    ).toHaveLength(0);
  });

  test('LIVE-03: Accept all persists consent and hides the banner across reload', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const notice = page.locator(NOTICE);
    await expect(notice).toBeVisible({ timeout: 10_000 });

    const accepted = await clickFirstVisible(page, [
      '[data-faz-tag="accept-button"] button',
      '[data-faz-tag="accept-button"]',
      '.faz-btn-accept',
    ]);
    expect(accepted, 'accept button was not found/clickable').toBeTruthy();

    await expect(notice).toBeHidden({ timeout: 10_000 });

    const consent = await getConsentCookie(page.context());
    expect(consent, 'consent cookie missing after accept').toBeDefined();
    const parsed = parseConsentCookie(consent!.value);
    expect(parsed.consent).toBe('yes');
    expect(parsed.necessary).toBe('yes');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(notice).toBeHidden({ timeout: 10_000 });
  });

  test('LIVE-04: Reject all records a choice and keeps optional categories off', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const notice = page.locator(NOTICE);
    await expect(notice).toBeVisible({ timeout: 10_000 });

    const rejected = await clickFirstVisible(page, [
      '[data-faz-tag="reject-button"] button',
      '[data-faz-tag="reject-button"]',
      '.faz-btn-reject',
      '[data-faz-tag="close-button"] button',
      '[data-faz-tag="close-button"]',
    ]);
    expect(rejected, 'reject/close button was not found/clickable').toBeTruthy();

    const consent = await getConsentCookie(page.context());
    expect(consent, 'consent cookie missing after reject').toBeDefined();
    const parsed = parseConsentCookie(consent!.value);
    expect(parsed.necessary).toBe('yes');

    const optional = Object.keys(parsed).filter(
      (k) => !['consentid', 'consent', 'action', 'necessary'].includes(k),
    );
    for (const key of optional) {
      expect(parsed[key], `Category "${key}" must not be granted after reject`).not.toBe('yes');
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(notice).toBeHidden({ timeout: 10_000 });
  });
});
