<?php

namespace App\Http\Requests\Web\Concerns;

/**
 * The sessionless public forms (WEB-05, WEB-10) carry no CSRF token, since a token needs a session row (ADR-115). A browser says where
 * a POST came from instead: Sec-Fetch-Site in every current browser, else Origin. A page of another site may not post in a visitor's
 * name. A client that sends neither (curl) passes; it gains nothing a visitor could not do, and the limits still apply.
 */
trait RefusesCrossSitePosts
{
    protected function isCrossSite(): bool
    {
        $site = $this->header('Sec-Fetch-Site');

        if (is_string($site) && $site !== '') {
            return ! in_array(strtolower($site), ['same-origin', 'none'], true);
        }

        $origin = $this->header('Origin');

        if (! is_string($origin) || $origin === '') {
            return false;
        }

        // The host this request reached (TrustHosts has vetted it), not APP_URL's: www and the bare domain both serve the form.
        return strtolower((string) parse_url($origin, PHP_URL_HOST)) !== strtolower($this->getHost());
    }
}
