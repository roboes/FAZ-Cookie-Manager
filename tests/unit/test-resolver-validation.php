<?php
/**
 * Unit test for L2-SP1-S006 fix — resolver runtime override validation.
 *
 * Confirms that when $valid_ruleset_ids is provided, an invalid
 * override.ruleset_id falls through to auto-detection rather than
 * returning the corrupted id.
 *
 * @package FazCookie\Tests\Unit
 */

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ );
}

require_once dirname( __DIR__, 2 ) . '/admin/modules/geo-routing/includes/class-ruleset-resolver.php';

use FazCookie\Admin\Modules\Geo_Routing\Includes\Ruleset_Resolver;

$tests_run = $tests_passed = $tests_failed = 0;
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

echo "\n== Resolver — runtime override validation (L2-SP1-S006) ==\n\n";

$index_countries = array( 'IT' => 'gdpr-italy', 'FR' => 'gdpr-france' );
$index_regions   = array();
$fallback        = 'fallback-gdpr-most-protective';
$valid_ids       = array( 'gdpr-italy', 'gdpr-france', 'gdpr-strict', 'fallback-gdpr-most-protective' );

// 1. Valid override returned as-is when whitelist provided.
$valid_override = array( 'IT' => array( 'ruleset_id' => 'gdpr-strict', 'delta' => array() ) );
assert_eq(
	Ruleset_Resolver::resolve( 'IT', null, false, $valid_override, $index_countries, $index_regions, $fallback, $valid_ids ),
	'gdpr-strict',
	'Valid override against whitelist → use override'
);

// 2. Invalid override falls through to auto-detection (whitelist provided).
$invalid_override = array( 'IT' => array( 'ruleset_id' => 'ruleset-that-does-not-exist', 'delta' => array() ) );
assert_eq(
	Ruleset_Resolver::resolve( 'IT', null, false, $invalid_override, $index_countries, $index_regions, $fallback, $valid_ids ),
	'gdpr-italy',
	'Invalid override + whitelist → auto-detect to gdpr-italy (graceful degrade)'
);

// 3. Invalid override returned as-is when no whitelist (legacy behavior preserved).
assert_eq(
	Ruleset_Resolver::resolve( 'IT', null, false, $invalid_override, $index_countries, $index_regions, $fallback, null ),
	'ruleset-that-does-not-exist',
	'Invalid override + no whitelist → legacy pass-through (BC preserved)'
);

// 4. Empty whitelist treats everything as invalid → fall-through.
assert_eq(
	Ruleset_Resolver::resolve( 'IT', null, false, $valid_override, $index_countries, $index_regions, $fallback, array() ),
	'gdpr-italy',
	'Empty whitelist + override → fall-through to auto-detect'
);

// ---------- Summary ----------

echo "\n--\n";
echo "Tests:  $tests_run\n";
echo "Passed: $tests_passed\n";
echo "Failed: $tests_failed\n\n";

if ( $tests_failed > 0 ) {
	echo "\033[31mFAIL\033[0m\n";
	exit( 1 );
}
echo "\033[32mPASS\033[0m\n";
exit( 0 );
