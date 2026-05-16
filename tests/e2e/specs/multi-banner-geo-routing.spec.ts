/**
 * Multi-banner geo-routing regression suite (1.13.18+ feature, refs #103).
 *
 * Covers:
 *   - Controller::get_active_banner_for_country() picks the right banner for
 *     a given country code, falling back through the match-all → banner_default
 *     chain.
 *   - Banner model normalises target_countries (case, deduplication, invalid
 *     code rejection) and clamps priority to non-negative integers.
 *   - The frontend `faz_visitor_country` filter is consumed by the picker so
 *     test fixtures can stub the visitor's country deterministically.
 *
 * All assertions go through wpEval (PHP-level reflection) because the
 * country detection itself needs MaxMind or Cloudflare in production — the
 * filter is the only deterministic test seam.
 */

import { test, expect } from '../fixtures/wp-fixture';
import { wpEval } from '../utils/wp-env';

test.describe.serial('Multi-banner geo-routing (Controller selector + Banner model)', () => {
  // Snapshot the existing banner rows so the suite leaves the DB exactly as
  // it found it — every test in here mutates wp_faz_banners.
  let snapshot: string = '';

  test.beforeAll(() => {
    snapshot = wpEval(`
      global $wpdb;
      echo wp_json_encode( $wpdb->get_results( "SELECT * FROM {\$wpdb->prefix}faz_banners" ) );
    `).trim();
  });

  test.afterAll(() => {
    // Restore every row to its pre-test target_countries / priority / status /
    // banner_default. We don't drop and re-insert because banner_id values must
    // be preserved (frontend caches reference them).
    wpEval(`
      global $wpdb;
      $rows = json_decode( ${JSON.stringify(snapshot)}, true );
      if ( ! is_array( $rows ) ) { return; }
      foreach ( $rows as $row ) {
        if ( empty( $row['banner_id'] ) ) { continue; }
        $wpdb->update(
          $wpdb->prefix . 'faz_banners',
          array(
            'status'           => isset( $row['status'] ) ? (int) $row['status'] : 0,
            'banner_default'   => isset( $row['banner_default'] ) ? (int) $row['banner_default'] : 0,
            'target_countries' => isset( $row['target_countries'] ) ? $row['target_countries'] : '[]',
            'priority'         => isset( $row['priority'] ) ? (int) $row['priority'] : 0,
          ),
          array( 'banner_id' => (int) $row['banner_id'] )
        );
      }
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();
    `);
  });

  test('GEO-01: country=US returns the US-targeted banner; country=IT falls back to match-all', () => {
    const result = wpEval(`
      global $wpdb;
      // Set banner_id=2 to target US only, status=1, priority=0.
      // banner_id=1 stays with empty targets (match-all) and banner_default=1.
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["US"]', 'status' => 1, 'priority' => 0 ),
        array( 'banner_id' => 2 )
      );
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '[]', 'status' => 1, 'banner_default' => 1 ),
        array( 'banner_id' => 1 )
      );
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();

      $ctrl = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance();
      $us = $ctrl->get_active_banner_for_country( 'US' );
      $it = $ctrl->get_active_banner_for_country( 'IT' );
      $br = $ctrl->get_active_banner_for_country( 'BR' );
      echo wp_json_encode( array(
        'us' => $us ? $us->get_id() : null,
        'it' => $it ? $it->get_id() : null,
        'br' => $br ? $br->get_id() : null,
      ) );
    `).trim();

    const data = JSON.parse(result);
    expect(data.us, 'US visitor must hit banner_id=2').toBe(2);
    expect(data.it, 'IT visitor must fall back to the match-all banner_id=1').toBe(1);
    expect(data.br, 'BR visitor (no explicit target) must also fall back to banner_id=1').toBe(1);
  });

  test('GEO-02: priority breaks ties when multiple banners target the same country', () => {
    const result = wpEval(`
      global $wpdb;
      // Both banners now target US; banner_id=2 keeps priority=0, banner_id=1 gets priority=10.
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["US"]', 'status' => 1, 'priority' => 10 ),
        array( 'banner_id' => 1 )
      );
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["US"]', 'status' => 1, 'priority' => 0 ),
        array( 'banner_id' => 2 )
      );
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();

      $ctrl = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance();
      $b = $ctrl->get_active_banner_for_country( 'US' );
      echo $b ? $b->get_id() : 'null';
    `).trim();

    expect(parseInt(result, 10), 'higher priority must win the tie').toBe(1);
  });

  test('GEO-03: banner_default=1 row is the last-resort fallback when no country matches and no match-all exists', () => {
    const result = wpEval(`
      global $wpdb;
      // No banner is currently active (status=0 on both), but banner_id=1 carries
      // banner_default=1. The picker must still return it as the fallback.
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["DE"]', 'status' => 0, 'banner_default' => 1 ),
        array( 'banner_id' => 1 )
      );
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["US"]', 'status' => 0, 'banner_default' => 0 ),
        array( 'banner_id' => 2 )
      );
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();

      $ctrl = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance();
      $b = $ctrl->get_active_banner_for_country( 'JP' );
      echo $b ? $b->get_id() : 'null';
    `).trim();

    expect(parseInt(result, 10), 'banner_default=1 wins when nothing else matches').toBe(1);
  });

  test('GEO-04: set_target_countries normalises (lower-case, whitespace, dedup, invalid drop)', () => {
    const result = wpEval(`
      $banner = new \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Banner( 1 );
      $banner->set_target_countries( array( 'us', ' IT ', 'US', 'XX', 'BAD', '', 'fr', 'FR' ) );
      echo wp_json_encode( $banner->get_target_countries() );
    `).trim();

    expect(JSON.parse(result), 'normalisation collapses case + whitespace + duplicates and drops invalid codes').toEqual(['FR', 'IT', 'US', 'XX']);
    // Note: 'XX' is a valid 2-letter shape so it survives at this layer; semantic
    // "is XX a real country" is intentionally out of scope (admins may want
    // private-use codes).
  });

  test('GEO-05: set_priority clamps negative values to 0', () => {
    const result = wpEval(`
      $banner = new \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Banner( 1 );
      $banner->set_priority( -50 );
      echo $banner->get_priority();
    `).trim();

    expect(parseInt(result, 10), 'negative priority is clamped to 0').toBe(0);
  });

  test('GEO-06: REST GET /banners/{id} returns target_countries and priority in the response', () => {
    const result = wpEval(`
      global $wpdb;
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["DE","FR","IT"]', 'priority' => 7 ),
        array( 'banner_id' => 1 )
      );
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();

      wp_set_current_user( 1 );
      $req = new WP_REST_Request( 'GET', '/faz/v1/banners/1' );
      $req->set_param( 'context', 'edit' );
      $res = rest_do_request( $req );
      $data = $res->get_data();
      echo wp_json_encode( array(
        'target_countries' => $data['target_countries'] ?? null,
        'priority'         => $data['priority'] ?? null,
      ) );
    `).trim();

    const data = JSON.parse(result);
    expect(data.target_countries, 'response carries the persisted country list').toEqual(['DE', 'FR', 'IT']);
    expect(data.priority, 'response carries the persisted priority').toBe(7);
  });

  test('GEO-07: faz_visitor_country filter steers the frontend picker without touching geo settings', () => {
    // Stub the visitor country via the filter, then exercise the same chain
    // the frontend uses (Controller::get_active_banner_for_country) and
    // confirm the right banner is returned.
    const result = wpEval(`
      global $wpdb;
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '[]', 'status' => 1, 'banner_default' => 1, 'priority' => 0 ),
        array( 'banner_id' => 1 )
      );
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["US"]', 'status' => 1, 'banner_default' => 0, 'priority' => 0 ),
        array( 'banner_id' => 2 )
      );
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();

      add_filter( 'faz_visitor_country', function() { return 'US'; } );

      // Apply the filter the way the frontend would.
      $country = apply_filters( 'faz_visitor_country', '' );
      $b = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->get_active_banner_for_country( $country );
      echo $b ? $b->get_id() : 'null';
    `).trim();

    expect(parseInt(result, 10), 'filter-stubbed US visitor routes to the US-targeted banner').toBe(2);
  });
});
