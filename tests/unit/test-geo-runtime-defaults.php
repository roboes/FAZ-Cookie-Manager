<?php
/**
 * Standalone unit tests for the runtime geo-routing wiring helpers on
 * FazCookie\Frontend\Frontend:
 *
 *   - ruleset_category_default()  (pure: ruleset state -> bool|null)
 *   - category_default_consent()  (ruleset state -> { gdpr, ccpa })
 *
 * These back the flag-gated `faz_geo_ruleset_runtime` feature: when the
 * resolved ruleset names a category, its default_categories state must win for
 * BOTH laws (necessary always granted), so the live banner reflects the
 * visitor's actual jurisdiction instead of the catalogue-only default.
 *
 * Run from project root:
 *   php tests/unit/test-geo-runtime-defaults.php
 *
 * Exit code 0 = all pass; 1 = at least one failure. Not a PHPUnit suite —
 * mirrors the lightweight CLI runner pattern of test-ruleset-resolver.php.
 * The private methods are invoked via reflection on an instance built with
 * newInstanceWithoutConstructor() so no WordPress runtime/DB is required; the
 * ruleset-override path is exercised by presetting the per-request memo so
 * get_runtime_ruleset() short-circuits before touching apply_filters().
 *
 * @package FazCookie\Tests\Unit
 */

// ---------- Bootstrap ----------

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ );
}

// The class file calls apply_filters() inside method bodies (never at parse
// time); stub it so the catalogue-only branch is testable in isolation.
if ( ! function_exists( 'apply_filters' ) ) {
	function apply_filters( $tag, $value ) { // phpcs:ignore
		return $value;
	}
}

require_once dirname( __DIR__, 2 ) . '/frontend/class-frontend.php';

use FazCookie\Frontend\Frontend;

// ---------- Minimal assert helpers ----------

$tests_run    = 0;
$tests_passed = 0;
$tests_failed = 0;

function assert_eq( $actual, $expected, $label ) {
	global $tests_run, $tests_passed, $tests_failed;
	$tests_run++;
	if ( $actual === $expected ) {
		$tests_passed++;
		echo "  \033[32m✓\033[0m " . $label . "\n";
	} else {
		$tests_failed++;
		echo "  \033[31m✗\033[0m " . $label . "\n";
		echo "      expected: " . var_export( $expected, true ) . "\n";
		echo "      actual:   " . var_export( $actual, true ) . "\n";
	}
}

// ---------- Reflection harness ----------

$ref      = new ReflectionClass( Frontend::class );
$frontend = $ref->newInstanceWithoutConstructor();

$m_default = $ref->getMethod( 'ruleset_category_default' );
$m_default->setAccessible( true );

$m_consent = $ref->getMethod( 'category_default_consent' );
$m_consent->setAccessible( true );

$p_memo = $ref->getProperty( 'faz_runtime_ruleset_memo' );
$p_memo->setAccessible( true );

/** Invoke the pure state->bool mapper. */
$map = function ( $ruleset, $slug ) use ( $frontend, $m_default ) {
	return $m_default->invoke( $frontend, $ruleset, $slug );
};

/** Set (or clear with null) the memoised runtime ruleset. */
$set_memo = function ( $ruleset ) use ( $frontend, $p_memo ) {
	// false = "not computed yet" → would call apply_filters; an explicit
	// array or null is treated as the resolved value by get_runtime_ruleset().
	$p_memo->setValue( $frontend, $ruleset );
};

/** Minimal stand-in for Cookie_Categories with just the getters the helper uses. */
$make_category = function ( $slug, $prior_consent, $sell, $share ) {
	return new class( $slug, $prior_consent, $sell, $share ) {
		private $slug;
		private $prior;
		private $sell;
		private $share;
		public function __construct( $slug, $prior, $sell, $share ) {
			$this->slug  = $slug;
			$this->prior = $prior;
			$this->sell  = $sell;
			$this->share = $share;
		}
		public function get_slug() {
			return $this->slug; }
		public function get_prior_consent() {
			return $this->prior; }
		public function get_sell_personal_data() {
			return $this->sell; }
		public function get_share_personal_data() {
			return $this->share; }
	};
};

// ---------- Tests: ruleset_category_default() state mapping ----------

echo "\n\033[1mruleset_category_default() — state → bool|null\033[0m\n";

$rs = function ( $cats ) {
	return array( 'ui' => array( 'default_categories' => $cats ) );
};

assert_eq( $map( $rs( array( 'analytics' => 'granted' ) ), 'analytics' ), true, "'granted' → true" );
assert_eq( $map( $rs( array( 'necessary' => 'granted-locked' ) ), 'necessary' ), true, "'granted-locked' → true" );
assert_eq( $map( $rs( array( 'marketing' => 'denied' ) ), 'marketing' ), false, "'denied' → false" );
assert_eq( $map( $rs( array( 'marketing' => 'denied-until-action' ) ), 'marketing' ), false, "'denied-until-action' → false" );
assert_eq( $map( $rs( array( 'analytics' => 'granted' ) ), 'marketing' ), null, 'slug absent from ruleset → null' );
assert_eq( $map( $rs( array( 'analytics' => 'weird-state' ) ), 'analytics' ), null, 'unknown state → null (fail safe)' );
assert_eq( $map( array(), 'analytics' ), null, 'no ui.default_categories → null' );
assert_eq( $map( array( 'ui' => array( 'default_categories' => 'not-an-array' ) ), 'analytics' ), null, 'malformed default_categories → null' );

// ---------- Tests: real law25-quebec.json ----------

echo "\n\033[1mreal ruleset: law25-quebec.json\033[0m\n";

$quebec_path = dirname( __DIR__, 2 ) . '/admin/modules/geo-routing/rulesets/law25-quebec.json';
$quebec      = json_decode( (string) file_get_contents( $quebec_path ), true );
assert_eq( is_array( $quebec ), true, 'law25-quebec.json loads as array' );

assert_eq( $map( $quebec, 'necessary' ), true, 'Quebec necessary (granted-locked) → true' );
assert_eq( $map( $quebec, 'functional' ), true, 'Quebec functional (granted) → true' );
assert_eq( $map( $quebec, 'analytics' ), false, 'Quebec analytics (denied-until-action) → false' );
assert_eq( $map( $quebec, 'marketing' ), false, 'Quebec marketing (denied-until-action) → false' );
assert_eq( $map( $quebec, 'profiling' ), false, 'Quebec profiling (denied-until-action) → false' );

// ---------- Tests: every shipped ruleset uses a known state vocabulary ----------

echo "\n\033[1mcatalogue invariant: default_categories states are in the known vocabulary\033[0m\n";

$known_states = array( 'granted', 'granted-locked', 'denied', 'denied-until-action' );
$rulesets_dir = dirname( __DIR__, 2 ) . '/admin/modules/geo-routing/rulesets';
$files        = glob( $rulesets_dir . '/*.json' );
$bad          = array();
foreach ( $files as $file ) {
	$data = json_decode( (string) file_get_contents( $file ), true );
	if ( ! is_array( $data ) || ! isset( $data['ui']['default_categories'] ) || ! is_array( $data['ui']['default_categories'] ) ) {
		continue;
	}
	foreach ( $data['ui']['default_categories'] as $slug => $state ) {
		if ( ! in_array( $state, $known_states, true ) ) {
			$bad[] = basename( $file ) . ":{$slug}={$state}";
		}
	}
}
assert_eq( $bad, array(), 'all ' . count( $files ) . ' rulesets use only known states (granted/granted-locked/denied/denied-until-action)' );

// ---------- Tests: category_default_consent() — catalogue (no runtime ruleset) ----------

echo "\n\033[1mcategory_default_consent() — catalogue baseline (memo = null)\033[0m\n";

$set_memo( null ); // resolved, but empty → base logic only.

// necessary: gdpr follows prior_consent flag; ccpa always exempt (true).
$cat = $make_category( 'necessary', true, false, false );
assert_eq( $m_consent->invoke( $frontend, $cat ), array( 'gdpr' => true, 'ccpa' => true ), 'necessary → gdpr=prior, ccpa=true' );

// marketing sold+shared: gdpr=prior (false), ccpa=false (opt-out-able).
$cat = $make_category( 'marketing', false, true, true );
assert_eq( $m_consent->invoke( $frontend, $cat ), array( 'gdpr' => false, 'ccpa' => false ), 'marketing sold/shared → gdpr=false, ccpa=false' );

// functional neither sold nor shared: ccpa exempt (true).
$cat = $make_category( 'functional', true, false, false );
assert_eq( $m_consent->invoke( $frontend, $cat ), array( 'gdpr' => true, 'ccpa' => true ), 'functional not sold/shared → ccpa=true' );

// analytics shared only: ccpa=false (sharing counts as sale for opt-out).
$cat = $make_category( 'analytics', false, false, true );
assert_eq( $m_consent->invoke( $frontend, $cat ), array( 'gdpr' => false, 'ccpa' => false ), 'analytics shared-only → ccpa=false' );

// ---------- Tests: category_default_consent() — runtime ruleset wins both laws ----------

echo "\n\033[1mcategory_default_consent() — runtime ruleset overrides BOTH laws\033[0m\n";

$set_memo( $quebec );

// analytics denied-until-action in Quebec → both laws denied, even though the
// category is NOT sold/shared (ccpa would otherwise be exempt=true).
$cat = $make_category( 'analytics', true, false, false );
assert_eq( $m_consent->invoke( $frontend, $cat ), array( 'gdpr' => false, 'ccpa' => false ), 'Quebec analytics → gdpr=false AND ccpa=false (ruleset wins)' );

// functional granted in Quebec → both laws granted.
$cat = $make_category( 'functional', false, true, true );
assert_eq( $m_consent->invoke( $frontend, $cat ), array( 'gdpr' => true, 'ccpa' => true ), 'Quebec functional → gdpr=true AND ccpa=true (ruleset wins, even though sold/shared)' );

// necessary always granted regardless of ruleset state.
$cat = $make_category( 'necessary', false, false, false );
assert_eq( $m_consent->invoke( $frontend, $cat ), array( 'gdpr' => true, 'ccpa' => true ), 'Quebec necessary → always granted' );

// marketing denied-until-action in Quebec → both denied.
$cat = $make_category( 'marketing', true, false, false );
assert_eq( $m_consent->invoke( $frontend, $cat ), array( 'gdpr' => false, 'ccpa' => false ), 'Quebec marketing → gdpr=false AND ccpa=false' );

// Category NOT named by the ruleset → falls back to base law logic.
$cat = $make_category( 'social', true, false, false );
assert_eq( $m_consent->invoke( $frontend, $cat ), array( 'gdpr' => true, 'ccpa' => true ), 'ruleset-unnamed slug → base logic (gdpr=prior, ccpa=exempt)' );

// ---------- Summary ----------

echo "\n";
echo "\033[1mRan {$tests_run} assertions: ";
echo "\033[32m{$tests_passed} passed\033[0m";
if ( $tests_failed > 0 ) {
	echo ", \033[31m{$tests_failed} failed\033[0m";
}
echo "\033[0m\n";

exit( $tests_failed > 0 ? 1 : 0 );
