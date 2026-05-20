<?php
/**
 * Class Secrets file — encryption helper for sensitive admin options.
 *
 * Spec: specs/001-geo-routing-next/spec.md
 * Task: T022 (P3 Pipeline)
 *
 * Encrypts strings at rest using a XOR keystream derived from
 * `wp_salt('auth')`. Sufficient against casual database dumps; NOT
 * a substitute for proper KMS. Used for storing the ipinfo.io API
 * key in `wp_options::faz_geo_ipinfo_api_key`.
 *
 * Constitution VIII Data Minimization — sensitive secrets never live
 * in cleartext in `wp_options`.
 *
 * @package FazCookie\Admin\Modules\Geo_Routing\Includes
 * @since   1.15.0
 */

namespace FazCookie\Admin\Modules\Geo_Routing\Includes;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Encryption helper.
 *
 * @class    Secrets
 * @since    1.15.0
 */
class Secrets {

	/**
	 * Encrypt a cleartext string for storage in wp_options.
	 *
	 * @param string $plain Cleartext.
	 * @return string Base64-encoded XOR ciphertext + version prefix 'v1:'.
	 */
	public static function encrypt( $plain ) {
		if ( ! is_string( $plain ) || '' === $plain ) {
			return '';
		}
		$key      = self::derive_key( strlen( $plain ) );
		$cipher   = $plain ^ $key;
		$key_hint = self::current_key_hint();
		// Format: v2:<8-hex-keyhint>:<base64-ciphertext>
		// v2 supersedes v1 (no hint) — v1 ciphertexts still decode for
		// backward compat with installs that encrypted via the old format.
		return 'v2:' . $key_hint . ':' . base64_encode( $cipher );
	}

	/**
	 * Decrypt a previously-encrypted string.
	 *
	 * Returns '' if input is unrecognizable OR if the key-hint indicates
	 * the salt has rotated since encryption. L1-SP1-S003 fix (1.15.0):
	 * the key-hint prefix lets the consumer detect salt rotation; an
	 * empty return triggers admin notice via Ipinfo_Client lookup path
	 * (which treats "" as "key missing" and surfaces the gap).
	 *
	 * @param string $cipher_str 'v1:' or 'v2:' prefixed ciphertext.
	 * @return string Decrypted plaintext or '' on failure.
	 */
	public static function decrypt( $cipher_str ) {
		if ( ! is_string( $cipher_str ) ) {
			return '';
		}
		// v2 path with salt-rotation hint check.
		if ( 0 === strpos( $cipher_str, 'v2:' ) ) {
			$parts = explode( ':', $cipher_str, 3 );
			if ( 3 !== count( $parts ) ) {
				return '';
			}
			$hint    = (string) $parts[1];
			$payload = (string) $parts[2];
			if ( $hint !== self::current_key_hint() ) {
				// Salt rotated — the keystream this ciphertext was
				// encrypted with is no longer derivable. Return empty
				// so the consumer (Ipinfo_Client) treats this as
				// "key missing" rather than silently produce garbage.
				return '';
			}
			$decoded = base64_decode( $payload, true );
			if ( false === $decoded || '' === $decoded ) {
				return '';
			}
			$key = self::derive_key( strlen( $decoded ) );
			return $decoded ^ $key;
		}
		// v1 backward-compat path (no hint — salt rotation undetectable).
		if ( 0 === strpos( $cipher_str, 'v1:' ) ) {
			$decoded = base64_decode( substr( $cipher_str, 3 ), true );
			if ( false === $decoded || '' === $decoded ) {
				return '';
			}
			$key = self::derive_key( strlen( $decoded ) );
			return $decoded ^ $key;
		}
		return '';
	}

	/**
	 * 8-char hint of the current key (used by v2 format for salt-rotation
	 * detection — see L1-SP1-S003 resolution).
	 *
	 * @return string
	 */
	private static function current_key_hint() {
		$salt = function_exists( 'wp_salt' ) ? (string) wp_salt( 'auth' ) : 'faz-fallback-salt-not-secure';
		return substr( hash( 'sha256', 'faz_secrets_v2|' . $salt ), 0, 8 );
	}

	/**
	 * Derive a keystream of the requested length from wp_salt('auth').
	 *
	 * @param int $length Bytes needed.
	 * @return string Keystream.
	 */
	private static function derive_key( $length ) {
		$length = max( 1, (int) $length );
		$salt   = function_exists( 'wp_salt' ) ? (string) wp_salt( 'auth' ) : 'faz-fallback-salt-not-secure';
		if ( '' === $salt ) {
			$salt = 'faz-fallback-salt-not-secure';
		}
		$stream = '';
		while ( strlen( $stream ) < $length ) {
			$stream .= hash( 'sha256', $salt . strlen( $stream ), true );
		}
		return substr( $stream, 0, $length );
	}
}
