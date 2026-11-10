<?php

namespace App\Http\Controllers\Admin\Support;

use Illuminate\Http\Request;

/**
 * The admin speaks German first, English on request (03 §14). The DE/EN toggle (top bar and sign-in pages) writes the cookie
 * `sc_admin_lang` in the browser (path /admin) and reloads: no route, so nothing to authorise and nothing a guest can call. The cookie
 * is not encrypted (it is set by script) and only ever compared with the two offered values. Outside production the visual matrix
 * picks the language per request with ?qaLocale=.
 */
final class AdminLocale
{
    public const COOKIE = 'sc_admin_lang';

    public const LOCALES = ['de', 'en'];

    public static function apply(Request $request): void
    {
        app()->setLocale(self::resolve($request));
    }

    public static function resolve(Request $request): string
    {
        $qa = $request->query('qaLocale');

        if (! app()->isProduction() && is_string($qa) && in_array($qa, self::LOCALES, true)) {
            return $qa;
        }

        // An encrypted cookie of the same name (set by a server response or a test) counts as well.
        $cookie = $request->cookie(self::COOKIE);

        if (is_string($cookie) && in_array($cookie, self::LOCALES, true)) {
            return $cookie;
        }

        return self::fromCookieHeader((string) $request->headers->get('Cookie')) ?? 'de';
    }

    /**
     * Read from the raw header: EncryptCookies drops every cookie it did not encrypt itself from the request's cookie bag.
     */
    private static function fromCookieHeader(string $header): ?string
    {
        return preg_match('/(?:^|;)\s*'.self::COOKIE.'=(de|en)\s*(?:;|$)/', $header, $match) === 1 ? $match[1] : null;
    }
}
