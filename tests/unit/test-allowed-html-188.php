<?php
/**
 * Regression test for issue #188: faz_allowed_html() must keep the <input>
 * `type` attribute even when another active plugin hooks
 * wp_kses_allowed_html( 'post' ) and adds its own 'input' definition.
 *
 * Subsystem: allowed-html-188
 *
 * The old code did:
 *     array_merge( array( 'input' => [type,style,id,class] ), wp_kses_allowed_html('post') )
 * With string keys, array_merge lets the SECOND array win, so a foreign
 * 'input' => ['value'=>true] entry fully overwrote ours and dropped type=true.
 * wp_kses() then stripped type="checkbox" from the category toggle, which
 * defaults to type="text" and renders as an editable field. The fix merges the
 * 'input' sub-array so both sides' attributes survive.
 *
 * Pure-logic: no browser, no DB, no live WordPress — WP surface is stubbed.
 *
 * Run: php tests/unit/test-allowed-html-188.php
 *
 * @package FazCookie\Tests\Unit
 */

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}

// Controllable double for another plugin's wp_kses_allowed_html filter: when
// $GLOBALS['__faz_foreign_input'] is set, the 'post' allowlist carries a foreign
// 'input' definition (mirroring a forms/comments plugin's hook).
$GLOBALS['__faz_foreign_input'] = null;

if ( ! function_exists( 'wp_kses_allowed_html' ) ) {
	function wp_kses_allowed_html( $context = 'post' ) {
		// A representative slice of the real 'post' allowlist (which does NOT
		// include 'input' by default).
		$tags = array(
			'a'      => array( 'href' => true, 'title' => true ),
			'strong' => array(),
			'p'      => array(),
		);
		if ( 'post' === $context && is_array( $GLOBALS['__faz_foreign_input'] ) ) {
			$tags['input'] = $GLOBALS['__faz_foreign_input'];
		}
		return $tags;
	}
}
if ( ! function_exists( 'apply_filters' ) ) {
	// No hooks registered in the test → return the value unchanged.
	function apply_filters( $tag, $value ) {
		return $value;
	}
}

require_once dirname( __DIR__, 2 ) . '/includes/class-formatting.php';

// ---------- Tiny assertion harness ----------
$passed = 0;
$failed = 0;
function check( $cond, $label ) {
	global $passed, $failed;
	if ( $cond ) {
		$passed++;
		echo "  [PASS] $label\n";
	} else {
		$failed++;
		echo "  [FAIL] $label\n";
	}
}

echo "== faz_allowed_html() input whitelist (issue #188) ==\n";

// 1. Baseline: no foreign plugin → our input attrs present.
$GLOBALS['__faz_foreign_input'] = null;
$html = faz_allowed_html();
check( isset( $html['input'] ) && is_array( $html['input'] ), '01 input tag is whitelisted' );
check( true === ( $html['input']['type'] ?? null ), '02 baseline: input keeps type' );
check( true === ( $html['input']['class'] ?? null ), '03 baseline: input keeps class' );

// 2. Another plugin adds its own 'input' via wp_kses_allowed_html('post').
//    type MUST survive (the bug dropped it), and the foreign attrs are kept too.
$GLOBALS['__faz_foreign_input'] = array(
	'value' => true,
	'name'  => true,
);
$html = faz_allowed_html();
check( true === ( $html['input']['type'] ?? null ), '04 foreign input filter: type is NOT clobbered (the fix)' );
check( true === ( $html['input']['style'] ?? null ), '05 foreign input filter: style survives' );
check( true === ( $html['input']['id'] ?? null ), '06 foreign input filter: id survives' );
check( true === ( $html['input']['value'] ?? null ), '07 foreign input filter: the other plugin\'s value is preserved' );
check( true === ( $html['input']['name'] ?? null ), '08 foreign input filter: the other plugin\'s name is preserved' );

// 3. Global attributes still applied to every tag (class comes via
//    _faz_global_attributes even when a tag declared none).
check( true === ( $html['input']['data-*'] ?? null ), '09 global attributes still merged onto input' );

echo "\nPassed: $passed\nFailed: $failed\n";
if ( $failed > 0 ) {
	echo "FAIL\n";
	exit( 1 );
}
echo "ALL PASS\n";
exit( 0 );
