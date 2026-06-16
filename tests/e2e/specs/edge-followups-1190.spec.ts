import { expect, test } from '../fixtures/wp-fixture';

/**
 * Edge regressions for the 1.19.0 follow-up fixes to the dynamically-created
 * <script> interceptor in frontend/js/script.js (subsystem: followups-1190).
 *
 * All four drive document.createElement('script') on a FRESH pre-consent visit
 * (optional categories denied, necessary allowed) and assert the interceptor's
 * type decisions:
 *   - the terminal category fallback now honours data-faz-category (not only
 *     data-fazcookie);
 *   - a type we did NOT clobber (e.g. type="module") is never downgraded, the
 *     restore being gated on the data-faz-original-type marker we set.
 *
 * The blockable / necessary category slugs are discovered from _fazStore at
 * runtime so the suite is independent of the site's exact category config.
 */

test.describe('Follow-up 1.19.0 — dynamic <script> interceptor (followups-1190)', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies(); // fresh = pre-consent, optional categories denied.
  });

  async function categories(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const w = window as unknown as { _fazStore?: { _categories?: Array<{ slug: string; isNecessary?: boolean }> } };
      const cats = w._fazStore?._categories ?? [];
      const necessary = cats.find((c) => c.isNecessary)?.slug || 'necessary';
      // First non-necessary category — denied before any consent action.
      const blockable = cats.find((c) => !c.isNecessary)?.slug || 'marketing';
      return { necessary, blockable };
    });
  }

  test('FU-01: a dynamic script tagged only with data-faz-category (denied) is blocked', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const { blockable } = await categories(page);

    const type = await page.evaluate((cat) => {
      const s = document.createElement('script');
      // A non-provider src (no Known_Provider match) + only the category tag —
      // exercises the terminal serviceCategory fallback, which must honour
      // data-faz-category just like data-fazcookie.
      s.setAttribute('src', 'https://cdn.example-not-a-provider.test/widget.js');
      s.setAttribute('data-faz-category', cat);
      return s.getAttribute('type');
    }, blockable);

    expect(type, `script in denied category "${blockable}" must be blocked`).toBe('javascript/blocked');
    await ctx.close();
  });

  test('FU-02: a dynamic script tagged with data-faz-category=necessary is NOT blocked', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const { necessary } = await categories(page);

    const type = await page.evaluate((cat) => {
      const s = document.createElement('script');
      s.setAttribute('src', 'https://cdn.example-not-a-provider.test/needed.js');
      s.setAttribute('data-faz-category', cat);
      return s.getAttribute('type');
    }, necessary);

    expect(type, `script in necessary category "${necessary}" must run`).not.toBe('javascript/blocked');
    await ctx.close();
  });

  test('FU-03: blocking a script records data-faz-original-type (the marker the restore guard relies on)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const { blockable } = await categories(page);

    const res = await page.evaluate((cat) => {
      const s = document.createElement('script');
      s.setAttribute('type', 'text/javascript');
      s.setAttribute('src', 'https://cdn.example-not-a-provider.test/tracker.js');
      s.setAttribute('data-faz-category', cat);
      return { type: s.getAttribute('type'), original: s.getAttribute('data-faz-original-type') };
    }, blockable);

    expect(res.type, 'blocked').toBe('javascript/blocked');
    expect(res.original, 'original type remembered so a later restore is bounded to scripts WE blocked').toBe('text/javascript');
    await ctx.close();
  });

  test('FU-04: a type="module" script we never blocked is NOT downgraded when data-faz-service is set', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(baseURL!, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const type = await page.evaluate(() => {
      const s = document.createElement('script');
      s.setAttribute('type', 'module');
      // No provider-matching src and an unknown service → _fazShouldChangeType is
      // false, so the interceptor must NOT restore (it never blocked it) and
      // must leave the legitimate module type intact.
      s.setAttribute('data-faz-service', 'an-unknown-service-not-in-the-catalogue');
      return s.getAttribute('type');
    });

    expect(type, 'a module script we never blocked stays a module (no spurious downgrade)').toBe('module');
    await ctx.close();
  });
});
