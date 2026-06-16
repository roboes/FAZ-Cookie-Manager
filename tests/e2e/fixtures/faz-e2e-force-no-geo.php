<?php
/**
 * Plugin Name: FAZ E2E — Force "no geo source"
 * Description: Test-only mu-plugin. Forces the "no country signal" condition so the
 *   banner editor's Geo Targeting "source not configured" notice renders
 *   deterministically: it returns false for the faz_trust_cf_ipcountry_header
 *   filter at the highest priority (overriding any dev fake-CF mu-plugin) and
 *   blanks the saved MaxMind license key for the request. Copied into
 *   wp-content/mu-plugins/ by geo-notice-clarity.spec.ts and removed afterwards.
 *   NEVER ship this.
 *
 * @package FazCookie\Tests
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Beat any dev fake-CF mu-plugin (which adds __return_true at the default priority).
add_filter( 'faz_trust_cf_ipcountry_header', '__return_false', 99999 );

// Make the MaxMind-key half of the notice's $faz_has_maxmind check false for the request.
add_filter(
	'option_faz_settings',
	function ( $settings ) {
		if ( is_array( $settings ) && isset( $settings['geolocation']['maxmind_license_key'] ) ) {
			$settings['geolocation']['maxmind_license_key'] = '';
		}
		return $settings;
	},
	99999
);
