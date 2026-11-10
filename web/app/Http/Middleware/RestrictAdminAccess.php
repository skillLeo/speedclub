<?php

namespace App\Http\Middleware;

use App\Support\ClientAddress;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\IpUtils;
use Symfony\Component\HttpFoundation\Response;

/**
 * The network fence of /admin (06_ADMIN_SPEC §3 Access, SEC-P1-20). On every staff route, the sign-in included, ahead of the session
 * (AdminServiceProvider pins both), so a refused request leaves no session row:
 *
 * - ADMIN_IP_ALLOWLIST set (IPv4/IPv6 addresses or CIDR ranges): any other client gets 404;
 * - ADMIN_DOMAIN set: the admin answers only on that host, 404 elsewhere.
 *
 * 404, not 403: a refused client learns nothing about what lives at /admin.
 *
 * Which address and host count (SEC-P3-05): with explicit TRUSTED_PROXIES, the client address and host TrustConfiguredProxies settled
 * (forwarded headers count only when they come from a listed proxy). With TRUSTED_PROXIES=* the fence never believes forwarded headers:
 * on a shared host the origin is often reachable around the proxy, and anyone could send X-Forwarded-For with an allow-listed address.
 * It decides on the connection address (REMOTE_ADDR) and the Host header instead, and logs a warning once per process: list the proxy
 * ranges. ADMIN_DOMAIN is no access control on its own (any client can send that Host); it only separates cookies and URLs.
 */
final class RestrictAdminAccess
{
    private static bool $warned = false;

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! self::allows($request)) {
            return new Response('', 404, ['Content-Type' => 'text/plain; charset=UTF-8', 'Cache-Control' => 'no-store']);
        }

        return $next($request);
    }

    public static function allows(Request $request): bool
    {
        $domain = config('speedclub.staff.domain');

        $untrusted = self::trustsEveryProxy();

        if (is_string($domain) && $domain !== '' && strcasecmp($untrusted ? self::hostHeader($request) : $request->getHost(), $domain) !== 0) {
            return false;
        }

        /** @var list<string> $allowlist */
        $allowlist = config()->array('speedclub.staff.ip_allowlist', []);

        if ($allowlist === []) {
            return true;
        }

        $ip = $untrusted ? (string) $request->server->get('REMOTE_ADDR', '') : (string) $request->ip();

        // An IPv4-mapped IPv6 address (::ffff:192.0.2.1) is matched as the IPv4 address it is.
        return IpUtils::checkIp($ip, $allowlist) || (! str_contains(ClientAddress::of($ip), '/') && IpUtils::checkIp(ClientAddress::of($ip), $allowlist));
    }

    /** TRUSTED_PROXIES=*: every sender may set forwarded headers, so the fence ignores them. */
    public static function trustsEveryProxy(): bool
    {
        $wildcard = in_array('*', config()->array('speedclub.trusted_proxies', []), true);

        if ($wildcard && ! self::$warned && config()->array('speedclub.staff.ip_allowlist', []) !== []) {
            self::$warned = true;
            Log::warning('ADMIN_IP_ALLOWLIST is set with TRUSTED_PROXIES=*: the admin fence uses the connection address. List the proxy ranges in TRUSTED_PROXIES.');
        }

        return $wildcard;
    }

    private static function hostHeader(Request $request): string
    {
        $host = (string) $request->headers->get('Host', '');

        // Without the port; an IPv6 literal keeps its brackets.
        return strtolower((string) preg_replace('/:\d+\z/', '', $host));
    }
}
