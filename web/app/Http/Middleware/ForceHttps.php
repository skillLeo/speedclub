<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sends plain HTTP to APP_URL, in production and only with FORCE_HTTPS on. A redirect here must never loop:
 *
 * - A trusted proxy that reports plain HTTP is believed: the request is redirected and comes back as HTTPS.
 * - A request that passed an unknown proxy but still looks insecure means TRUSTED_PROXIES is missing. It is already HTTPS
 *   on the outside, so redirecting it would loop forever. It passes; a spoofed header only spares its sender a redirect.
 * - A proxy that adds no such header cannot be told apart from a direct request, which is why the switch stays off until
 *   someone has checked the host (.env.example).
 * - The health check stays reachable on either scheme.
 */
class ForceHttps
{
    private const PROXY_HEADERS = ['X-Forwarded-Proto', 'X-Forwarded-Scheme', 'X-Forwarded-Ssl', 'X-Url-Scheme', 'Front-End-Https', 'Cf-Visitor'];

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        return $this->shouldRedirect($request)
            ? new RedirectResponse(rtrim(config()->string('app.url'), '/').$request->getRequestUri(), $request->isMethodSafe() ? 301 : 308)
            : $next($request);
    }

    private function shouldRedirect(Request $request): bool
    {
        if (! config()->boolean('speedclub.force_https') || ! app()->isProduction() || $request->isSecure() || $request->is('up')) {
            return false;
        }

        if (! str_starts_with(config()->string('app.url'), 'https://')) {
            return false;
        }

        if ($request->isFromTrustedProxy() && $request->headers->has('X-Forwarded-Proto')) {
            return true;
        }

        foreach (self::PROXY_HEADERS as $header) {
            if ($request->headers->has($header)) {
                return false;
            }
        }

        return true;
    }
}
