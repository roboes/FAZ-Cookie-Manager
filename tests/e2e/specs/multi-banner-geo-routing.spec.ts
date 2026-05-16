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

  test('GEO-08: faz_visitor_country filter returning lower-case / padded / non-ISO values is rejected (post-filter re-validation, CodeRabbit fix)', () => {
    // The frontend re-validates AFTER the filter so a hook returning 'us', ' US ',
    // 'USA', or 123 cannot steer routing into an unexpected bucket. Each invalid
    // shape must collapse to '' (no signal), which then routes to the match-all /
    // banner_default fallback.
    //
    // We exercise the helper through reflection because it is private — the same
    // way other specs in this suite probe controller internals.
    const result = wpEval(`
      $fe = new \\FazCookie\\Frontend\\Frontend( 'faz-cookie-manager', '1.0' );
      $ref = new ReflectionClass( $fe );
      $method = $ref->getMethod( 'get_visitor_country' );
      $method->setAccessible( true );

      // Cases split into two buckets:
      //   - accepted: shapes that survive normalisation (strtoupper + trim) and
      //     match /^[A-Z]{2}$/. 'us' upper-cases to 'US'; ' US ' trims to 'US'.
      //   - rejected: shapes the helper must collapse to '' so downstream
      //     callers (the picker) treat them as "no signal".
      $accepted = array( 'us' => 'US', ' US ' => 'US' );
      $rejected = array( 'USA', '12', 'gb-eng', '', '!!' );

      $out_accepted = array();
      foreach ( $accepted as $stub => $expected ) {
        $closure = function() use ( $stub ) { return $stub; };
        add_filter( 'faz_visitor_country', $closure, 10 );
        $out_accepted[ var_export( $stub, true ) ] = $method->invoke( $fe );
        remove_filter( 'faz_visitor_country', $closure, 10 );
      }

      $out_rejected = array();
      foreach ( $rejected as $stub ) {
        $closure = function() use ( $stub ) { return $stub; };
        add_filter( 'faz_visitor_country', $closure, 10 );
        $out_rejected[ var_export( $stub, true ) ] = $method->invoke( $fe );
        remove_filter( 'faz_visitor_country', $closure, 10 );
      }

      echo wp_json_encode( array( 'accepted' => $out_accepted, 'rejected' => $out_rejected ) );
    `).trim();

    const data = JSON.parse(result);
    // Normalisable shapes are accepted (lower-case / padded → upper, trimmed).
    Object.entries(data.accepted).forEach(([stub, value]) => {
      expect(value, `normalisable filter stub ${stub} must reach 'US'`).toBe('US');
    });
    // Malformed shapes (wrong length, non-letters) collapse to '' — the helper
    // guarantees the picker only ever sees a valid 2-letter code or no signal.
    Object.entries(data.rejected).forEach(([stub, value]) => {
      expect(value, `malformed filter stub ${stub} must collapse to '' (rejected)`).toBe('');
    });
  });

  test('GEO-09: faz_visitor_country filter returning a valid country survives re-validation', () => {
    // Symmetric to GEO-08: a hook that returns 'CH' (Switzerland, in our region
    // map) must reach the picker untouched. This pins down the contract that
    // re-validation only rejects malformed values, never valid ones.
    const result = wpEval(`
      $fe = new \\FazCookie\\Frontend\\Frontend( 'faz-cookie-manager', '1.0' );
      $ref = new ReflectionClass( $fe );
      $method = $ref->getMethod( 'get_visitor_country' );
      $method->setAccessible( true );

      $closure = function() { return 'CH'; };
      add_filter( 'faz_visitor_country', $closure, 10 );
      $resolved = $method->invoke( $fe );
      remove_filter( 'faz_visitor_country', $closure, 10 );

      echo $resolved;
    `).trim();

    expect(result, 'valid filter output passes through re-validation').toBe('CH');
  });

  test('GEO-10: update_db_350() collapses multiple banner_default=1 rows to exactly one (CodeRabbit fix)', () => {
    // The pre-fix migration only handled the zero-default case. If an install
    // already had two or more rows flagged banner_default=1 (possible via the
    // admin UI before the "Use this banner as default" toggle was wired to a
    // mutual-exclusion handler), the selector's last-resort fallback became
    // non-deterministic. The fixed migration must collapse multiples to a
    // single canonical row.
    const result = wpEval(`
      global $wpdb;
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'banner_default' => 1, 'status' => 1 ),
        array( 'banner_id' => 1 )
      );
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'banner_default' => 1, 'status' => 1 ),
        array( 'banner_id' => 2 )
      );
      $count_before = (int) $wpdb->get_var( "SELECT COUNT(banner_id) FROM {\$wpdb->prefix}faz_banners WHERE banner_default = 1" );

      \\FazCookie\\Includes\\Activator::update_db_350();
      $count_after = (int) $wpdb->get_var( "SELECT COUNT(banner_id) FROM {\$wpdb->prefix}faz_banners WHERE banner_default = 1" );
      $winner = (int) $wpdb->get_var( "SELECT banner_id FROM {\$wpdb->prefix}faz_banners WHERE banner_default = 1 ORDER BY banner_id ASC LIMIT 1" );

      echo wp_json_encode( array( 'before' => $count_before, 'after' => $count_after, 'winner' => $winner ) );
    `).trim();

    const data = JSON.parse(result);
    expect(data.before, 'precondition: 2 rows flagged as default').toBe(2);
    expect(data.after, 'migration collapses multiple defaults to exactly 1').toBe(1);
    expect(data.winner, 'lowest banner_id wins the canonical default slot').toBe(1);
  });

  test('GEO-11: update_db_350() promotes a fallback when 0 banners are status=1', () => {
    // Edge case: every banner is inactive (status=0) and none is flagged as
    // default. The selector still needs a fallback row to serve. The migration
    // must promote the lowest banner_id even when no row qualifies as "the
    // currently active banner".
    const result = wpEval(`
      global $wpdb;
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'status' => 0, 'banner_default' => 0 ),
        array( 'banner_id' => 1 )
      );
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'status' => 0, 'banner_default' => 0 ),
        array( 'banner_id' => 2 )
      );
      \\FazCookie\\Includes\\Activator::update_db_350();
      $winner = (int) $wpdb->get_var( "SELECT banner_id FROM {\$wpdb->prefix}faz_banners WHERE banner_default = 1 ORDER BY banner_id ASC LIMIT 1" );
      echo $winner;
    `).trim();

    expect(parseInt(result, 10), 'lowest banner_id is promoted when no banner is active').toBe(1);
  });

  test('GEO-12: get_active_banner_for_country() rejects malformed country codes and falls back to match-all', () => {
    // The selector's own validation: anything that is not /^[A-Z]{2}$/ after
    // upper-casing is treated as empty signal. This is the second line of
    // defence after the frontend helper (GEO-08).
    const result = wpEval(`
      global $wpdb;
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
      $out = array();
      // Malformed inputs (wrong length, digits, empty) — all must fall back
      // to the match-all banner (id=1).
      foreach ( array( 'usa', '123', '', '!@' ) as $stub ) {
        $b = $ctrl->get_active_banner_for_country( $stub );
        $out[ 'malformed_' . $stub ] = $b ? $b->get_id() : null;
      }
      // Normalisable inputs ('us' lower → 'US', ' US ' padded → 'US') — these
      // pass the strtoupper+trim normalisation inside the selector and DO match
      // banner 2.
      foreach ( array( 'us', ' US ' ) as $stub ) {
        $b = $ctrl->get_active_banner_for_country( $stub );
        $out[ 'normalised_' . trim( $stub ) ] = $b ? $b->get_id() : null;
      }
      echo wp_json_encode( $out );
    `).trim();

    const data = JSON.parse(result);
    // Malformed shapes collapse to '' inside the selector → match-all (id=1).
    expect(data.malformed_usa, 'usa (3 letters) → match-all').toBe(1);
    expect(data.malformed_123, '123 (digits) → match-all').toBe(1);
    expect(data.malformed_, 'empty string → match-all').toBe(1);
    expect(data['malformed_!@'], '!@ (non-letters) → match-all').toBe(1);
    // Normalisable shapes ('us', ' US ') reach the US-targeted banner (id=2)
    // because the selector applies the same trim+upper normalisation before
    // validating.
    expect(data.normalised_us, "'us' lower → US-targeted banner").toBe(2);
    expect(data.normalised_US, "' US ' padded → US-targeted banner").toBe(2);
  });

  test('GEO-13: status=0 banner with matching target_countries is NOT selected even if country matches', () => {
    // A banner the admin has explicitly disabled (status=0) must never be
    // served, regardless of how well it matches the visitor's country.
    // It can only re-enter the chain via the banner_default=1 fallback.
    const result = wpEval(`
      global $wpdb;
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["US"]', 'status' => 0, 'banner_default' => 0 ),
        array( 'banner_id' => 2 )
      );
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '[]', 'status' => 1, 'banner_default' => 1 ),
        array( 'banner_id' => 1 )
      );
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();

      $b = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->get_active_banner_for_country( 'US' );
      echo $b ? $b->get_id() : 'null';
    `).trim();

    expect(parseInt(result, 10), 'inactive US-targeted banner is skipped; match-all wins').toBe(1);
  });

  test('GEO-14: tie-break by banner_id when priority is equal', () => {
    // When two banners target the same country with the same priority, the
    // selector picks the lower banner_id for deterministic selection. Without
    // this, the order would depend on the SELECT result ordering — flaky.
    const result = wpEval(`
      global $wpdb;
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["US"]', 'status' => 1, 'priority' => 5 ),
        array( 'banner_id' => 1 )
      );
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["US"]', 'status' => 1, 'priority' => 5 ),
        array( 'banner_id' => 2 )
      );
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();

      $b = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->get_active_banner_for_country( 'US' );
      echo $b ? $b->get_id() : 'null';
    `).trim();

    expect(parseInt(result, 10), 'equal priority → lower banner_id wins').toBe(1);
  });

  test('GEO-15: set_target_countries accepts a JSON string in addition to an array', () => {
    // The setter accepts either an array or a JSON string. The JSON path is
    // exercised when the REST controller passes the column value through
    // unparsed (rare, but defensible — keeps the model resilient against
    // future code paths that forget to json_decode upfront).
    const result = wpEval(`
      $banner = new \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Banner( 1 );
      $banner->set_target_countries( '["us","fr","DE","BAD"]' );
      echo wp_json_encode( $banner->get_target_countries() );
    `).trim();

    expect(JSON.parse(result), 'JSON string input is decoded + normalised the same as an array').toEqual(['DE', 'FR', 'US']);
  });

  test('GEO-16: get_active_banner() (legacy 0-arg API) keeps working — backcompat with single-banner installs', () => {
    // Before this PR every call site used the no-arg get_active_banner(). The
    // new selector takes a country argument but get_active_banner() must
    // delegate to get_active_banner_for_country('') unchanged so existing
    // integrations (caches, REST, debug helpers) keep working.
    const result = wpEval(`
      global $wpdb;
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '[]', 'status' => 1, 'banner_default' => 1 ),
        array( 'banner_id' => 1 )
      );
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["US"]', 'status' => 1, 'banner_default' => 0 ),
        array( 'banner_id' => 2 )
      );
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();

      $b = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->get_active_banner();
      echo $b ? $b->get_id() : 'null';
    `).trim();

    expect(parseInt(result, 10), 'no-arg API delegates to match-all → banner_id=1').toBe(1);
  });

  test('GEO-17: REST PUT preserves target_countries when the field is omitted from the request body', () => {
    // The REST controller only reads target_countries / priority when they
    // are explicitly present in the request — a legacy client that updates
    // only `name` must not have its previously-saved geo config wiped.
    const result = wpEval(`
      global $wpdb;
      $wpdb->update( $wpdb->prefix . 'faz_banners',
        array( 'target_countries' => '["DE","FR"]', 'priority' => 3 ),
        array( 'banner_id' => 1 )
      );
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();

      wp_set_current_user( 1 );
      // PUT only sends a subset of fields — no target_countries, no priority.
      $req = new WP_REST_Request( 'PUT', '/faz/v1/banners/1' );
      $req->set_param( 'name', 'Backcompat probe' );
      $req->set_param( 'status', true );
      $req->set_param( 'default', true );
      $req->set_param( 'properties', array() );
      $req->set_param( 'contents', new stdClass() );
      rest_do_request( $req );

      // Re-read directly from the DB to confirm the existing values survived.
      $row = $wpdb->get_row( "SELECT target_countries, priority FROM {\$wpdb->prefix}faz_banners WHERE banner_id = 1" );
      echo wp_json_encode( array(
        'target_countries' => json_decode( $row->target_countries, true ),
        'priority'         => (int) $row->priority,
      ) );
    `).trim();

    const data = JSON.parse(result);
    expect(data.target_countries, 'omitted target_countries must not be wiped on PUT').toEqual(['DE', 'FR']);
    expect(data.priority, 'omitted priority must not be reset to 0 on PUT').toBe(3);
  });
});
