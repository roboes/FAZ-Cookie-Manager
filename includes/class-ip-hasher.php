<?php
/**
 * Shared IP hashing for rate-limiting handlers.
 *
 * @package FazCookie\Includes
 */

namespace FazCookie\Includes;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Provides a salted HMAC hash of the visitor's IP address for rate-limiting
 * and audit-log keys. Used by DSAR_Shortcode and Do_Not_Sell_Shortcode.
 */
trait IP_Hasher {

	/**
	 * Return a salted hash of the visitor's IP address.
	 *
	 * @return string 64-char hex string.
	 */
	private function hash_ip() {
		$ip = \faz_resolve_client_ip();
		if ( empty( $ip ) ) {
			// Group missing-IP requests intentionally without hashing an empty string.
			$ip = 'no-ip';
		}
		return hash_hmac( 'sha256', $ip, wp_salt( 'auth' ) );
	}

	/**
	 * Debug-only public accessor for `hash_ip()`.
	 *
	 * Exposed exclusively under `WP_DEBUG` for E2E regression coverage so
	 * tests can assert the hash is a valid SHA-256 hex string without
	 * resorting to `ReflectionMethod::setAccessible()` (which would lock
	 * the spec to the private method's visibility and silently break on
	 * any future refactor of the trait).
	 *
	 * Returns an empty string in production. Callers must check `WP_DEBUG`
	 * themselves before relying on the return value.
	 *
	 * @return string Either the 64-char hex hash, or '' when WP_DEBUG is off.
	 */
	public function debug_hash_ip() {
		if ( ! defined( 'WP_DEBUG' ) || ! WP_DEBUG ) {
			return '';
		}
		return $this->hash_ip();
	}
}
