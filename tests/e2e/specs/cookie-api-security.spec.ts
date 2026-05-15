/**
 * E2E tests for Cookie REST API security fixes applied in the adamsreview below-gate pass:
 *
 *   COOKIE-SEC-01  sanitize_script_field: non-admin user gets 403 WP_Error (not silent preserve)
 *   COOKIE-DATA-01 get_prepared_data: opt_in_script / opt_out_script absent from base data
 *   COOKIE-DATA-02 get_script_data: script fields available on explicit call
 *   COOKIE-DATA-03 REST API edit context: script fields present for admin via get_formatted_item_data
 */

import { expect } from '@playwright/test';
import { test } from '../fixtures/wp-fixture';
import { wpEval } from '../utils/wp-env';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFirstCookieId(): number {
  const raw = wpEval(`
    global $wpdb;
    echo (int) $wpdb->get_var( "SELECT cookie_id FROM {$wpdb->prefix}faz_cookies LIMIT 1" );
  `).trim();
  return parseInt(raw, 10);
}

// ── COOKIE-SEC-01 ─────────────────────────────────────────────────────────────

test.describe('COOKIE-SEC-01 — non-admin user gets 403 when saving script fields', () => {
  test.describe.configure({ mode: 'serial' });

  let cookieId = 0;
  let subscriberId = 0;

  test.beforeAll(() => {
    cookieId = getFirstCookieId();

    // Create a one-off subscriber for this test; clean up in afterAll.
    const raw = wpEval(`
      $uid = wp_insert_user( array(
        'user_login' => 'faz_e2e_sub_' . substr( uniqid(), -8 ),
        'user_pass'  => 'password',
        'role'       => 'subscriber',
      ) );
      echo is_wp_error( $uid ) ? 0 : (int) $uid;
    `).trim();
    subscriberId = parseInt(raw, 10);
  });

  test.afterAll(() => {
    if (subscriberId) {
      wpEval(`wp_delete_user( ${subscriberId} );`);
    }
  });

  test('subscriber PUT with opt_in_script returns HTTP 403', () => {
    expect(cookieId, 'a cookie must exist in the DB to run this test').toBeGreaterThan(0);
    expect(subscriberId, 'subscriber user must have been created').toBeGreaterThan(0);

    const status = wpEval(`
      wp_set_current_user( ${subscriberId} );
      $nonce = wp_create_nonce( 'wp_rest' );
      $req = new WP_REST_Request( 'PUT', '/faz/v1/cookies/${cookieId}' );
      $req->set_header( 'X-WP-Nonce', $nonce );
      $req->set_param( 'opt_in_script', 'alert(1)' );
      $resp = rest_do_request( $req );
      echo $resp->get_status();
    `).trim();

    expect(parseInt(status, 10), 'subscriber opt_in_script update must return 403').toBe(403);
  });

  test('subscriber PUT with opt_out_script returns HTTP 403', () => {
    expect(cookieId).toBeGreaterThan(0);
    expect(subscriberId).toBeGreaterThan(0);

    const status = wpEval(`
      wp_set_current_user( ${subscriberId} );
      $nonce = wp_create_nonce( 'wp_rest' );
      $req = new WP_REST_Request( 'PUT', '/faz/v1/cookies/${cookieId}' );
      $req->set_header( 'X-WP-Nonce', $nonce );
      $req->set_param( 'opt_out_script', 'alert(2)' );
      $resp = rest_do_request( $req );
      echo $resp->get_status();
    `).trim();

    expect(parseInt(status, 10), 'subscriber opt_out_script update must return 403').toBe(403);
  });

  test('admin PUT with opt_in_script is accepted (does not return 403)', () => {
    // Sanity-check: the admin (user ID 1) must NOT be rejected.
    expect(cookieId).toBeGreaterThan(0);

    const status = wpEval(`
      wp_set_current_user( 1 );
      $nonce = wp_create_nonce( 'wp_rest' );
      $req = new WP_REST_Request( 'PUT', '/faz/v1/cookies/${cookieId}' );
      $req->set_header( 'X-WP-Nonce', $nonce );
      $req->set_param( 'opt_in_script', '' );
      $resp = rest_do_request( $req );
      echo $resp->get_status();
    `).trim();

    const code = parseInt(status, 10);
    expect(code, 'admin opt_in_script update must not return 403').not.toBe(403);
    // 200 or 201 are both valid success codes.
    expect(code).toBeGreaterThanOrEqual(200);
    expect(code).toBeLessThan(300);
  });
});

// ── COOKIE-DATA-01 / 02 / 03 ─────────────────────────────────────────────────

test.describe('COOKIE-DATA — script field isolation in Cookie class', () => {
  test.describe.configure({ mode: 'serial' });

  let cookieId = 0;

  test.beforeAll(() => {
    cookieId = getFirstCookieId();
  });

  test('COOKIE-DATA-01: get_prepared_data() does not include opt_in_script or opt_out_script', () => {
    expect(cookieId).toBeGreaterThan(0);

    const raw = wpEval(`
      $cookie = new \\FazCookie\\Admin\\Modules\\Cookies\\Includes\\Cookie( ${cookieId} );
      echo wp_json_encode( array_keys( $cookie->get_prepared_data() ) );
    `).trim();

    const keys: string[] = JSON.parse(raw);
    expect(keys, 'get_prepared_data() must not contain opt_in_script').not.toContain('opt_in_script');
    expect(keys, 'get_prepared_data() must not contain opt_out_script').not.toContain('opt_out_script');

    // Sanity-check: core fields must still be present.
    expect(keys).toContain('id');
    expect(keys).toContain('name');
    expect(keys).toContain('slug');
  });

  test('COOKIE-DATA-02: get_script_data() returns only opt_in_script and opt_out_script', () => {
    expect(cookieId).toBeGreaterThan(0);

    const raw = wpEval(`
      $cookie = new \\FazCookie\\Admin\\Modules\\Cookies\\Includes\\Cookie( ${cookieId} );
      echo wp_json_encode( array_keys( $cookie->get_script_data() ) );
    `).trim();

    const keys: string[] = JSON.parse(raw);
    expect(keys, 'get_script_data() must contain opt_in_script').toContain('opt_in_script');
    expect(keys, 'get_script_data() must contain opt_out_script').toContain('opt_out_script');

    // The method must NOT return unrelated fields.
    expect(keys, 'get_script_data() must not contain id').not.toContain('id');
    expect(keys, 'get_script_data() must not contain name').not.toContain('name');
  });

  test('COOKIE-DATA-03: REST GET /faz/v1/cookies/{id}?context=edit includes script fields for admin', () => {
    expect(cookieId).toBeGreaterThan(0);

    const raw = wpEval(`
      wp_set_current_user( 1 );
      $req = new WP_REST_Request( 'GET', '/faz/v1/cookies/${cookieId}' );
      $req->set_param( 'context', 'edit' );
      $resp = rest_do_request( $req );
      $data = $resp->get_data();
      echo wp_json_encode( array_keys( is_array( $data ) ? $data : array() ) );
    `).trim();

    const keys: string[] = JSON.parse(raw);
    expect(keys, 'REST edit context must include opt_in_script for admin').toContain('opt_in_script');
    expect(keys, 'REST edit context must include opt_out_script for admin').toContain('opt_out_script');
  });

  test('COOKIE-DATA-04: REST GET /faz/v1/cookies/{id} (view context) excludes script fields', () => {
    expect(cookieId).toBeGreaterThan(0);

    // Public / view context should not expose raw JS — the REST schema registers
    // opt_in_script / opt_out_script with context: ['edit'] so WP strips them
    // from the response automatically when context=view.
    const raw = wpEval(`
      wp_set_current_user( 0 );
      $req = new WP_REST_Request( 'GET', '/faz/v1/cookies/${cookieId}' );
      $req->set_param( 'context', 'view' );
      $resp = rest_do_request( $req );
      $data = $resp->get_data();
      echo wp_json_encode( array_keys( is_array( $data ) ? $data : array() ) );
    `).trim();

    // Either: response is 401 (unauthenticated) or the keys array lacks the script fields.
    let keys: string[] = [];
    try { keys = JSON.parse(raw); } catch { /* 401 → empty body or WP_Error serialised */ }
    expect(keys, 'REST view context must not contain opt_in_script').not.toContain('opt_in_script');
    expect(keys, 'REST view context must not contain opt_out_script').not.toContain('opt_out_script');
  });
});
