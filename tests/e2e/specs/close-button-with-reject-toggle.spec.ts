/**
 * Per-banner override of the Garante/EDPB close-button auto-hide (1.14.0+).
 *
 * Default behaviour (pre-1.14.0 and post-1.14.0): when a banner has both a
 * Reject button and a Close (X) button enabled, Template::prepare_html()
 * strips the X from the rendered HTML. The reason is regulatory — EDPB
 * Guidelines 03/2022 and Garante Privacy Provv. 10/06/2021 treat the
 * "neutral X + labelled Reject" combination on the same banner as a
 * recognised dark pattern.
 *
 * 1.14.0 adds a per-banner opt-out flag at `settings.allowCloseButtonWithReject`.
 * Use case: with multi-banner geo-routing in the same release, an admin
 * can serve a Reject-mandatory GDPR banner to EU visitors AND a separate
 * CCPA-style banner with the X visible to US visitors, without the dark-
 * pattern auto-hide stripping the X from the second one.
 *
 * All four cases below exercise Template directly (not the live frontend)
 * so the test is deterministic: it inspects the rendered HTML string for
 * the presence of `data-faz-tag="close-button"`.
 */

import { test, expect } from '../fixtures/wp-fixture';
import { wpEval } from '../utils/wp-env';

test.describe.serial('Close button per-banner override vs Garante/EDPB dark-pattern auto-hide', () => {
  let snapshotSettings = '';
  let snapshotCloseStatus = '';

  test.beforeAll(() => {
    // Snapshot the active banner's settings JSON + close-button status so
    // we can restore both at teardown. The tests mutate both.
    snapshotSettings = wpEval(`
      $banner = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->get_active_banner();
      echo $banner ? wp_json_encode( $banner->get_settings() ) : '';
    `).trim();
    snapshotCloseStatus = wpEval(`
      $banner = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->get_active_banner();
      $s = $banner ? $banner->get_settings() : array();
      echo isset( $s['config']['notice']['elements']['closeButton']['status'] ) && $s['config']['notice']['elements']['closeButton']['status'] ? '1' : '0';
    `).trim();
  });

  test.afterAll(() => {
    wpEval(`
      $banner = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->get_active_banner();
      if ( $banner ) {
        $restored = json_decode( ${JSON.stringify(snapshotSettings)}, true );
        if ( is_array( $restored ) ) {
          $banner->set_settings( $restored );
          $banner->save();
        }
      }
      delete_option( 'faz_banner_template' );
      if ( function_exists( 'faz_clear_banner_template_cache' ) ) {
        faz_clear_banner_template_cache();
      }
      \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->delete_cache();
    `);
  });

  // Helper: configure the active banner with the given button visibilities and
  // override flag, then render the template and return the HTML string.
  function renderActiveBannerHtml(opts: {
    rejectStatus: boolean;
    closeStatus: boolean;
    allowOverride: boolean;
  }): string {
    return wpEval(`
      $banner = \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Controller::get_instance()->get_active_banner();
      $settings = $banner->get_settings();
      if ( ! is_array( $settings ) ) { $settings = array(); }
      if ( ! isset( $settings['settings'] ) || ! is_array( $settings['settings'] ) ) { $settings['settings'] = array(); }
      $settings['settings']['allowCloseButtonWithReject'] = ${opts.allowOverride ? 'true' : 'false'};

      // Force the banner shape that exposes both Reject and Close buttons in
      // the rendered HTML. Use the notice elements layer (where the rest of
      // the codebase already keeps button visibility for the picker).
      if ( ! isset( $settings['config'] ) || ! is_array( $settings['config'] ) ) { $settings['config'] = array(); }
      if ( ! isset( $settings['config']['notice'] ) || ! is_array( $settings['config']['notice'] ) ) { $settings['config']['notice'] = array(); }
      if ( ! isset( $settings['config']['notice']['elements'] ) || ! is_array( $settings['config']['notice']['elements'] ) ) { $settings['config']['notice']['elements'] = array(); }

      $els =& $settings['config']['notice']['elements'];
      if ( ! isset( $els['closeButton'] ) || ! is_array( $els['closeButton'] ) ) { $els['closeButton'] = array(); }
      $els['closeButton']['status'] = ${opts.closeStatus ? 'true' : 'false'};

      // Reject button lives nested under notice.elements.buttons.elements.reject in the runtime config.
      if ( ! isset( $els['buttons'] ) || ! is_array( $els['buttons'] ) ) { $els['buttons'] = array(); }
      if ( ! isset( $els['buttons']['elements'] ) || ! is_array( $els['buttons']['elements'] ) ) { $els['buttons']['elements'] = array(); }
      if ( ! isset( $els['buttons']['elements']['reject'] ) || ! is_array( $els['buttons']['elements']['reject'] ) ) { $els['buttons']['elements']['reject'] = array(); }
      $els['buttons']['elements']['reject']['status'] = ${opts.rejectStatus ? 'true' : 'false'};

      $banner->set_settings( $settings );
      $banner->save();
      delete_option( 'faz_banner_template' );

      // Re-load the banner to get the post-sanitize settings, then render.
      $reread = new \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Banner( $banner->get_id() );
      $template = new \\FazCookie\\Admin\\Modules\\Banners\\Includes\\Template( $reread, 'en' );
      echo base64_encode( (string) $template->get_html() );
    `).trim();
  }

  function htmlContainsCloseButton(b64Html: string): boolean {
    const html = Buffer.from(b64Html, 'base64').toString('utf8');
    return /data-faz-tag=["']close-button["']/.test(html);
  }

  test('CB-OV-01: default behaviour preserved — reject ON + close ON + override OFF → close removed from HTML', () => {
    const html = renderActiveBannerHtml({ rejectStatus: true, closeStatus: true, allowOverride: false });
    expect(htmlContainsCloseButton(html), 'Compliance auto-hide must still fire on the default banner').toBe(false);
  });

  test('CB-OV-02: per-banner override ON — reject ON + close ON + override ON → close kept in HTML', () => {
    const html = renderActiveBannerHtml({ rejectStatus: true, closeStatus: true, allowOverride: true });
    expect(htmlContainsCloseButton(html), 'allowCloseButtonWithReject=true keeps the X alongside Reject').toBe(true);
  });

  test('CB-OV-03: reject OFF + close ON + override OFF → close kept (no dark-pattern conflict)', () => {
    const html = renderActiveBannerHtml({ rejectStatus: false, closeStatus: true, allowOverride: false });
    expect(htmlContainsCloseButton(html), 'no Reject = no dark-pattern conflict, X stays without needing the override').toBe(true);
  });

  test('CB-OV-04: close OFF (admin disabled X explicitly) — override flag has no effect', () => {
    const html = renderActiveBannerHtml({ rejectStatus: true, closeStatus: false, allowOverride: true });
    // The "Show Close Button" admin toggle is the authoritative signal: if
    // the admin disabled the X, the override flag must not resurrect it.
    expect(htmlContainsCloseButton(html), 'closeButton.status=false trumps the override flag').toBe(false);
  });
});
