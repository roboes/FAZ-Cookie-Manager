<?php
/**
 * Class Cookies file.
 *
 * @package FazCookie
 */

namespace FazCookie\Admin\Modules\Cookies;

use FazCookie\Includes\Modules;
use FazCookie\Admin\Modules\Cookies\Includes\Cookie_Controller;
use FazCookie\Admin\Modules\Cookies\Includes\Category_Controller;
use FazCookie\Admin\Modules\Cookies\Api\Categories_API;
use FazCookie\Admin\Modules\Cookies\Api\Cookies_API;
use FazCookie\Admin\Modules\Cookies\Api\Cookie_Scraper;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Handles Cookies Operation
 *
 * @class       Cookies
 * @version     3.0.0
 * @package     FazCookie
 */
class Cookies extends Modules {

	/**
	 * Constructor.
	 */
	public function init() {
		$this->load_apis();
		add_action( 'faz_after_update_cookie', array( Category_Controller::get_instance(), 'delete_cache' ) );
		add_action( 'faz_after_update_cookie', array( Cookie_Controller::get_instance(), 'delete_cache' ) );
		add_action( 'faz_after_update_cookie_category', array( Cookie_Controller::get_instance(), 'delete_cache' ) );
		add_action( 'faz_after_update_cookie_category', array( Category_Controller::get_instance(), 'delete_cache' ) );
		// Create / delete hooks: Cookie_Controller already clears its OWN cache
		// in create_item() / delete_item() before firing the action, so adding
		// a `Cookie_Controller::delete_cache` listener here would be a
		// redundant second flush on every write. Category_Controller's
		// get_items() cache, however, embeds the per-category cookie list and
		// has no such self-invalidation — so it MUST be invalidated whenever a
		// cookie is created or deleted, otherwise the frontend
		// _categories[].cookies payload keeps a stale list after a new cookie
		// is added via the REST API.
		add_action( 'faz_after_create_cookie', array( Category_Controller::get_instance(), 'delete_cache' ) );
		add_action( 'faz_after_delete_cookie', array( Category_Controller::get_instance(), 'delete_cache' ) );
		add_action( 'faz_reinstall_tables', array( Category_Controller::get_instance(), 'reinstall' ) );
		add_action( 'faz_reinstall_tables', array( Cookie_Controller::get_instance(), 'reinstall' ) );
	}

	/**
	 * Load API files
	 *
	 * @return void
	 */
	public function load_apis() {
		$cookie_cat_api = new Categories_API();
		$cookie_api     = new Cookies_API();
		$cookie_scraper = new Cookie_Scraper();
	}
}
