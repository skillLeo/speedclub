<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Client round 7: one host per site. The live site answered on both https://www.joinspeedclub.com and https://joinspeedclub.com
 * (APP_URL). Cookies are host-only, so the two were separate admin sessions: a password confirmed, a sign-in or a draft on one host was
 * unknown on the other, and a bookmark on www saved into another session than the tab on the apex.
 *
 * A request on a host listed in TRUSTED_HOSTS (speedclub.trusted_hosts) that is not APP_URL's host goes to the same path on APP_URL's
 * scheme and host: 301 for GET and HEAD, 308 for every other method (the method and body are kept). Never redirected: APP_URL's own host
 * (staging is its own APP_URL), ADMIN_DOMAIN (the admin's own host), localhost, IP addresses (LAN builds of the app), any host not in
 * TRUSTED_HOSTS (TrustHosts refuses those before this runs) and the health check.
 */
final class RedirectToCanonicalHost
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $target = self::target($request);

        return $target === null ? $next($request) : new RedirectResponse($target, $request->isMethodSafe() ? 301 : 308);
    }

    /** The canonical URL of this request, or null when it is already on the right host or must not move. */
    public static function target(Request $request): ?string
    {
        $appUrl = config()->string('app.url');
        $canonical = parse_url($appUrl, PHP_URL_HOST);
        $host = strtolower($request->getHost());

        if (! is_string($canonical) || $canonical === '' || $host === '' || $host === strtolower($canonical) || $request->is('up')) {
            return null;
        }

        if ($host === 'localhost' || str_ends_with($host, '.localhost') || filter_var(trim($host, '[]'), FILTER_VALIDATE_IP) !== false) {
            return null;
        }

        $adminDomain = config('speedclub.staff.domain');
        if (is_string($adminDomain) && $adminDomain !== '' && $host === strtolower($adminDomain)) {
            return null;
        }

        /** @var list<string> $trusted */
        $trusted = config()->array('speedclub.trusted_hosts', []);
        if (! in_array($host, array_map(strtolower(...), $trusted), true)) {
            return null;
        }

        return rtrim($appUrl, '/').$request->getRequestUri();
    }
}
