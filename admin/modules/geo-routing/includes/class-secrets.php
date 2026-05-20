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
		$key = self::derive_key( strlen( $plain ) );
		// Fail explicit when wp_salt() isn't available / returned empty
		// (e.g., extremely early boot, salts wiped from wp-config). The
		// previous shared fallback 'faz-fallback-salt-not-secure' made
		// the keystream globally guessable for every install in that
		// state — better to refuse to encrypt and surface the gap.
		if ( '' === $key ) {
			return '';
		}
		$key_hint = self::current_key_hint();
		if ( '' === $key_hint ) {
			return '';
		}
		// Format: v2:<8-hex-keyhint>:<base64-ciphertext>
		return 'v2:' . $key_hint . ':' . base64_encode( $plain ^ $key );
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
			$hint     = (string) $parts[1];
			$payload  = (string) $parts[2];
			$cur_hint = self::current_key_hint();
			if ( '' === $cur_hint || $hint !== $cur_hint ) {
				// Either wp_salt() is unavailable now, or the salt has
				// rotated since encryption — in both cases the keystream
				// is no longer derivable. Return empty so the consumer
				// (Ipinfo_Client) treats this as "key missing" rather
				// than silently producing garbage.
				return '';
			}
			$decoded = base64_decode( $payload, true );
			if ( false === $decoded || '' === $decoded ) {
				return '';
			}
			$key = self::derive_key( strlen( $decoded ) );
			if ( '' === $key ) {
				return '';
			}
			return $decoded ^ $key;
		}
		// v1 backward-compat path — DEPRECATED.
		// Pre-v2 ciphertexts have no key hint, so we cannot detect salt
		// rotation. Returning the XOR result blindly would emit arbitrary
		// bytes whenever wp_salt('auth') had rotated since encryption,
		// and those bytes would then be sent as a bearer token to
		// ipinfo.io. Refuse to decode v1 ciphertext — consumers will see
		// "key missing", the admin notice surfaces, and the operator
		// re-enters the API key (which gets re-encrypted as v2). Any
		// active install upgrading from v1 → v2 thus performs a one-time
		// re-entry; no install written by this version produces v1.
		if ( 0 === strpos( $cipher_str, 'v1:' ) ) {
			return '';
		}
		return '';
	}

	/**
	 * 8-char hint of the current key (used by v2 format for salt-rotation
	 * detection — see L1-SP1-S003 resolution).
	 *
	 * Returns empty when wp_salt() isn't available or returned an empty
	 * string — caller must treat this as "encryption unavailable" rather
	 * than substitute a fallback (the previous shared literal made every
	 * install in that state cryptographically indistinguishable).
	 *
	 * @return string 8 hex chars, or '' when no valid salt is available.
	 */
	private static function current_key_hint() {
		if ( ! function_exists( 'wp_salt' ) ) {
			return '';
		}
		$salt = (string) wp_salt( 'auth' );
		if ( '' === $salt ) {
			return '';
		}
		return substr( hash( 'sha256', 'faz_secrets_v2|' . $salt ), 0, 8 );
	}

	/**
	 * Derive a keystream of the requested length from wp_salt('auth').
	 *
	 * Returns empty string when no valid salt is available — callers MUST
	 * check for this and refuse to encrypt rather than fall back to a
	 * predictable keystream.
	 *
	 * @param int $length Bytes needed.
	 * @return string Keystream, or '' on no-salt.
	 */
	private static function derive_key( $length ) {
		$length = max( 1, (int) $length );
		if ( ! function_exists( 'wp_salt' ) ) {
			return '';
		}
		$salt = (string) wp_salt( 'auth' );
		if ( '' === $salt ) {
			return '';
		}
		$stream = '';
		while ( strlen( $stream ) < $length ) {
			$stream .= hash( 'sha256', $salt . strlen( $stream ), true );
		}
		return substr( $stream, 0, $length );
	}
}
