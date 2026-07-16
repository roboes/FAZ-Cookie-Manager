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
 * — FlyingPress\Purge::purge_pages() clears only the cached HTML
 * (*.html.gz), which is all that changes when a banner / cookie / setting
 * is saved. purge_everything() is kept as a fallback for older builds that
 * predate purge_pages(); it additionally wipes FlyingPress's generated
 * minified CSS/JS, forcing a full site-wide re-minify on the next visit —
 * disproportionate for an HTML-only invalidation.
 *
 * No preload/re-warm is triggered. FlyingPress\Preload::preload_cache()
 * is NOT the lightweight non-blocking call the docs imply: it enumerates
 * every published post of every public post type, plus every taxonomy term
 * and author URL, inline on the save request before queueing the HTTP
 * warms. Running a full-site crawl on every banner/cookie/settings save is
 * disproportionate and out of step with the other purge-only adapters
 * (WP Rocket, LiteSpeed, W3TC) — the purge alone already resolves #125.
 *
 * The purge is wrapped in try/catch: clear_cache() runs inside
 * do_action( 'faz_after_update_*' ), which has no per-callback try/catch,
 * so an uncaught throw would abort every other cache adapter still queued
 * on the same hook AND surface a raw fatal on the admin save. Fail closed —
 * degrade to a no-op, matching the reflection bridge in
 * frontend/class-frontend.php.
 */
class Flying_Press extends Services {

	/**
	 * Load plugin hooks
	 *
	 * @return void
	 */
	public function run() {
		$this->load_hooks();
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
		try {
			// Only the rendered HTML changes on a banner/cookie/settings
			// save, so purge just the cached HTML pages. purge_everything()
			// is the fallback for older builds that predate purge_pages().
			if ( is_callable( array( '\FlyingPress\Purge', 'purge_pages' ) ) ) {
				\FlyingPress\Purge::purge_pages();
			} elseif ( is_callable( array( '\FlyingPress\Purge', 'purge_everything' ) ) ) {
				\FlyingPress\Purge::purge_everything();
			} else {
				return false;
			}
		} catch ( \Throwable $error ) {
			// Fail closed — see the class docblock: an uncaught throw here
			// would abort the remaining cache adapters on the same
			// do_action() hook and fatal the admin save.
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				error_log( 'FAZ Cookie Manager: FlyingPress purge failed — ' . $error->getMessage() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			}
			return false;
		}
		return true;
	}
}
