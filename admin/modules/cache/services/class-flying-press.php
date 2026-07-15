<?php
/**
 * FlyingPress cache service adapter.
 *
 * @package FazCookie\Includes
 */

namespace FazCookie\Admin\Modules\Cache\Services;

use FazCookie\Admin\Modules\Cache\Services\Services;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * FlyingPress (flyingpress.com) purge integration.
 *
 * FlyingPress caches the fully rendered page HTML, so a banner / cookie /
 * settings change would keep serving the stale banner markup until its
 * cache expires or an admin purges it by hand — reported in issue #125
 * ("Cookie banner not saving", FlyingPress + Redis object cache: saving
 * only worked after deactivating FlyingPress and purging its cache).
 * Purging on the faz_after_update_* hooks brings it in line with the
 * other supported page caches (WP Rocket, LiteSpeed, W3TC, …).
 *
 * Uses the API documented at
 * https://docs.flyingpress.com/en/articles/11406092-programmatically-purge-and-preload-cache
 * — FlyingPress\Purge::purge_everything() (full purge; purge_pages() as a
 * fallback for older builds) and FlyingPress\Preload::preload_cache() to
 * re-warm the cache. Both are documented as non-blocking and safe to call
 * from hooks. Calls are guarded with is_callable() so a future FlyingPress
 * refactor degrades to a no-op instead of a fatal.
 */
class Flying_Press extends Services {

	/**
	 * Load plugin hooks
	 *
	 * @return void
	 */
	public function run() {
		$this->load_hooks();
		$this->exclude_scripts_from_optimization();
	}

	/**
	 * Keep the consent scripts out of FlyingPress's JS delay / defer / minify.
	 *
	 * FlyingPress does not honour the `data-cfasync` / `data-no-optimize` /
	 * `data-no-minify` attributes the plugin already prints on its own script
	 * tags, and its "Delay all JavaScript" mode holds every script until the
	 * first user interaction. With that on, the banner script is delayed too,
	 * so the consent banner appears late or not at all — a compliance problem,
	 * not merely a UX one.
	 *
	 * FlyingPress 4.16+ exposes filters to exclude JS from delay/defer, and
	 * 5.0+ one for minify; the exclusion matches a substring of the full
	 * `<script>` tag (src, id and inline content). The `faz-cookie-manager` and
	 * `faz-fw` keywords match every consent script by its enqueue handle id
	 * (`faz-cookie-manager-js`, `…-gcm-js`, `…-tcf-cmp-js`, `…-a11y-js`, and the
	 * alt-asset `faz-fw-*` variants), which is independent of the install
	 * folder name, and also matches their `…/faz-cookie-manager/frontend/js/…`
	 * src path. Registered only when FlyingPress is active (Services::run() is
	 * gated on is_active()); a no-op when the filters do not exist.
	 *
	 * Filter names + merge pattern mirror the FlyingPress integration in Real
	 * Cookie Banner (devowl-wp/cache-invalidate, GPLv3), reimplemented here.
	 *
	 * @return void
	 */
	public function exclude_scripts_from_optimization() {
		$keywords = array( 'faz-cookie-manager', 'faz-fw' );
		$exclude  = static function ( $excluded ) use ( $keywords ) {
			return array_merge( is_array( $excluded ) ? $excluded : array(), $keywords );
		};
		$filters = array(
			'flying_press_exclude_from_delay:js',
			'flying_press_exclude_from_defer:js',
			'flying_press_exclude_from_minify:js',
		);
		foreach ( $filters as $filter ) {
			add_filter( $filter, $exclude );
		}
	}

	/**
	 * Check if the the cache service is installed/active;
	 *
	 * @return boolean
	 */
	public function is_active() {
		return class_exists( '\FlyingPress\Purge' );
	}

	/**
	 * Clear the cache if any.
	 *
	 * @param boolean $clear Skip the purge when false (hook arg passthrough).
	 * @return boolean|void
	 */
	public function clear_cache( $clear = true ) {
		if ( false === $clear ) {
			return;
		}
		if ( is_callable( array( '\FlyingPress\Purge', 'purge_everything' ) ) ) {
			\FlyingPress\Purge::purge_everything();
		} elseif ( is_callable( array( '\FlyingPress\Purge', 'purge_pages' ) ) ) {
			\FlyingPress\Purge::purge_pages();
		} else {
			return false;
		}
		// Re-warm the purged cache; queued/non-blocking per FlyingPress docs.
		if ( is_callable( array( '\FlyingPress\Preload', 'preload_cache' ) ) ) {
			\FlyingPress\Preload::preload_cache();
		}
		return true;
	}
}
