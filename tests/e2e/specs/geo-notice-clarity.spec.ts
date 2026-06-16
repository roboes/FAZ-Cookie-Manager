import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../fixtures/wp-fixture';
import { WP_PATH, wpEval } from '../utils/wp-env';

/**
 * Regression for the wp.org support topic "confused by
 * faz_trust_cf_ipcountry_header": the "Geo source not configured" notice in the
 * banner editor's Geo Targeting tab used to say "enable the
 * faz_trust_cf_ipcountry_header", which read like a UI setting an admin could
 * turn on. It must now make clear that it is a developer CODE filter and show
 * the add_filter() snippet, with MaxMind GeoLite2 as the recommended fix.
 *
 * The notice only renders when no country signal is configured. A
 * test-only mu-plugin forces that condition deterministically (overrides any
 * dev fake-CF mu-plugin and blanks the MaxMind key) so the test does not depend
 * on the ambient geo setup. It is installed for this spec only and removed
 * afterwards.
 */
const FIXTURE_SRC = fileURLToPath(new URL('../fixtures/faz-e2e-force-no-geo.php', import.meta.url));
const MU_DEST = WP_PATH ? join(WP_PATH, 'wp-content', 'mu-plugins', 'faz-e2e-force-no-geo.php') : '';

test.describe('Geo "source not configured" notice clarity', () => {
  test.skip(!WP_PATH, 'WP_PATH is required to install the no-geo-source fixture mu-plugin');

  test.beforeAll(() => {
    copyFileSync(FIXTURE_SRC, MU_DEST);
  });

  test.afterAll(() => {
    if (MU_DEST && existsSync(MU_DEST)) {
      rmSync(MU_DEST);
    }
  });

  test('presents faz_trust_cf_ipcountry_header as a developer filter, not a UI setting', async ({ page, loginAsAdmin }) => {
    // A real downloaded GeoLite2 DB would hide the notice regardless of the
    // mu-plugin (has_database() reads the filesystem). Skip rather than fail in
    // that rare environment; assert in the common (no-DB) case.
    const hasDb = wpEval('echo \\FazCookie\\Includes\\Geolocation::has_database() ? "yes" : "no";').trim();
    test.skip(hasDb === 'yes', 'A GeoLite2 database is installed; the "not configured" notice cannot render');

    await loginAsAdmin(page);
    await page.goto('/wp-admin/admin.php?page=faz-cookie-manager-banner', { waitUntil: 'domcontentloaded' });

    await page.click('button.faz-tab[data-tab="geo"]');

    const notice = page
      .locator('#tab-geo .faz-card')
      .filter({ hasText: 'Geo source not configured' })
      .first();
    await expect(notice, 'the no-geo-source notice renders').toBeVisible();

    const text = ((await notice.textContent()) ?? '').replace(/\s+/g, ' ');

    // New, clarified wording.
    expect(text, 'mentions it is a developer filter').toContain('developer');
    expect(text, 'states it is NOT a screen setting').toMatch(/NOT a setting in this screen/i);
    expect(text, 'shows the add_filter snippet').toMatch(/add_filter\(\s*'faz_trust_cf_ipcountry_header'\s*,\s*'__return_true'\s*\)/);
    expect(text, 'recommends a MaxMind GeoLite2 key').toContain('MaxMind GeoLite2 license key');

    // The old confusing phrasing ("enable the <filter>") is gone.
    expect(text, 'no longer says "enable the" filter').not.toMatch(/enable the\s+faz_trust_cf_ipcountry_header/i);
  });
});
