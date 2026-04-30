const consentType = {
    gdpr: 'optin',
    ccpa: 'optout',
};
// FAZ category → WP Consent API category mapping.
//   - `functional`  → 'preferences'
//   - `analytics`   → ['statistics', 'statistics-anonymous']
//   - `marketing`   → 'marketing'
//   - `advertisement` → 'marketing' (back-compat: cookies stored before
//                       the 1.13.5 advertisement→marketing rename still
//                       arrive here verbatim — see gcm.js + tcf-cmp.js
//                       for the same shim)
//   - `performance` → 'statistics' (was an inadvertent → 'functional'
//                     mapping pre-1.13.12; corrected because the
//                     Settings UI exposes `performance` as a runtime
//                     category and admins selecting it expect analytics
//                     gating, not preferences gating)
const categoryMap = {
    functional: 'preferences',
    analytics: ['statistics', 'statistics-anonymous'],
    marketing: 'marketing',
    advertisement: 'marketing',
    performance: 'statistics',
};
const gskEnabled = typeof _fazGsk !== 'undefined' && _fazGsk ? _fazGsk : false;
document.addEventListener("fazcookie_consent_update", function () {
    const consentData = getFazConsent();
    const categories = consentData.categories;
    if ((consentData.isUserActionCompleted === false) && gskEnabled && !Object.values(categories).slice(1).includes(true)) {
        return;
    }
    window.wp_consent_type = consentData.activeLaw ? consentType[consentData.activeLaw] : 'optin';
    let event = new CustomEvent('wp_consent_type_defined');
    document.dispatchEvent( event );
    Object.entries(categories).forEach(([key, value]) => {
        if (!(key in categoryMap))
            return;
        setConsentStatus(key, value ? 'allow' : 'deny');
    });
    function setConsentStatus(key, status) {
        if (Array.isArray(categoryMap[key])) {
            categoryMap[key].forEach(el => {
                wp_set_consent(el, status);
            });
        } else {
            wp_set_consent(categoryMap[key], status);
        }
    }
});