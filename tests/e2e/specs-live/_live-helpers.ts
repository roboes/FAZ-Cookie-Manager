import type { BrowserContext, Page } from '@playwright/test';

/**
 * Shared, dependency-free helpers for the LIVE read-only smoke/compliance
 * suites. Deliberately self-contained (no wp-fixture / wp-env imports) so
 * nothing here can mutate a production WordPress install.
 */

export const CONSENT_COOKIE = 'fazcookie-consent';
export const NOTICE = '[data-faz-tag="notice"]';

// Technically-necessary cookies allowed before consent (mirror of
// TECHNICAL_COOKIE_RE in tests/e2e/fixtures/wp-fixture.ts).
export const TECHNICAL_COOKIE_RE = [
  /^wordpress_/i,
  /^wp-settings/i,
  /^PHPSESSID$/i,
  /^wordpress_test_cookie$/i,
  /^wp_lang$/i,
  /^fazcookie-consent$/,
  /^fazVendorConsent$/,
  /^euconsent-v2$/,
];

// Well-known third-party trackers — a concrete denylist so benign first-party
// cache/CDN cookies (QUIC.cloud, etc.) never cause false failures.
export const TRACKER_COOKIE_RE = [
  /^_ga(_|$)/i, /^_gid$/i, /^_gat/i, /^_gcl/i,
  /^_fbp$/i, /^_fbc$/i, /^fr$/i,
  /^_clck$/i, /^_clsk$/i, /^MUID$/i,
  /^_hj/i,
];

// Tracker network endpoints contacted only once a script is unblocked. Their
// presence in network traffic is a stronger ePrivacy signal than cookies.
export const TRACKER_URL_RE =
  /google-analytics\.com|googletagmanager\.com|\/gtag\/js|doubleclick\.net|connect\.facebook\.net|facebook\.com\/tr|clarity\.ms|static\.hotjar\.com|bat\.bing\.com/i;

export function parseConsentCookie(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of decodeURIComponent(value).split(',')) {
    const [key, ...rest] = chunk.split(':');
    if (key) out[key.trim()] = rest.join(':').trim();
  }
  return out;
}

export async function getConsentCookie(context: BrowserContext) {
  const cookies = await context.cookies();
  return cookies.find((c) => c.name === CONSENT_COOKIE);
}

/**
 * Click the first selector that becomes visible within `timeout` ms. Unlike a
 * bare `isVisible()` check, this waits for the element to settle — the live
 * banner animates in behind a CDN, so a naive visibility probe races the
 * reveal and intermittently misses the button.
 */
export async function clickFirstVisible(
  page: Page,
  selectors: string[],
  timeout = 6000,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  for (const sel of selectors) {
    const remaining = Math.max(500, deadline - Date.now());
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: remaining });
      await loc.click();
      return true;
    } catch {
      /* not visible in time — try the next selector */
    }
  }
  return false;
}
