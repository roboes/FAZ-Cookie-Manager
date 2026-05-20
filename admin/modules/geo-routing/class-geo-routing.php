<?php
/**
 * Class Geo_Routing file — module orchestrator for jurisdictional rule-sets.
 *
 * Spec: specs/001-geo-routing-next/spec.md
 * Task: T001 (P1 Foundation — module scaffolding)
 *
 * @package FazCookie\Admin\Modules\Geo_Routing
 */

namespace FazCookie\Admin\Modules\Geo_Routing;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Module orchestrator for geo-routing v2.
 *
 * Placeholder at P1. Concrete responsibilities materialize in later phases:
 *   - P2: triggers `\FazCookie\Includes\Migration_V2::run()` on activation.
 *   - P3: instantiates `Includes\Geo_Detector`, `Includes\Ipinfo_Client`,
 *         `Includes\Ruleset_Loader`, `Includes\Ruleset_Resolver`.
 *   - P6: registers admin tab and REST endpoints via `Api\Geo_Api`.
 *
 * Until then this class is intentionally inert — instantiation must be a
 * no-op so that the P1 scaffolding does not regress any of the baseline
 * 21 + 12 + 10 compliance / verification / E2E tests.
 *
 * @class    Geo_Routing
 * @package  FazCookie\Admin\Modules\Geo_Routing
 * @since    1.15.0
 */
class Geo_Routing {

	/**
	 * Singleton instance.
	 *
	 * @var Geo_Routing|null
	 */
	private static $instance = null;

	/**
	 * Plugin version this module was first introduced in.
	 *
	 * @var string
	 */
	const SINCE = '1.15.0';

	/**
	 * Return the current instance (singleton).
	 *
	 * Constitution §Stack: every module orchestrator follows the
	 * `get_instance()` singleton pattern used by Banners, Cookies,
	 * GCM, Settings, etc.
	 *
	 * @return Geo_Routing
	 */
	public static function get_instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Private constructor — singleton.
	 */
	private function __construct() {
		// Intentionally empty at P1. Wiring lands in subsequent phases.
	}

	/**
	 * Path to the rulesets catalog directory (admin/modules/geo-routing/rulesets/).
	 *
	 * Helper used by Ruleset_Loader (T008) to resolve JSON files. Lives
	 * on the orchestrator so a test or override can swap it via filter.
	 *
	 * @return string Absolute filesystem path with trailing slash.
	 */
	public function get_rulesets_dir() {
		/**
		 * Filter the rulesets catalog directory location.
		 *
		 * Default: the bundled `admin/modules/geo-routing/rulesets/`.
		 * Override to point at a custom directory (e.g. for testing or
		 * site-specific ruleset libraries).
		 *
		 * @since 1.15.0
		 * @param string $path Absolute path with trailing slash.
		 */
		return apply_filters(
			'faz_geo_rulesets_dir',
			trailingslashit( __DIR__ . '/rulesets' )
		);
	}

	/**
	 * Path to the JSON schema for ruleset validation.
	 *
	 * Used by CI validator (T003) and by Ruleset_Loader (T008) to verify
	 * each loaded `.json` matches the contract.
	 *
	 * @return string Absolute filesystem path.
	 */
	public function get_schema_path() {
		return __DIR__ . '/schemas/ruleset.schema.json';
	}
}
