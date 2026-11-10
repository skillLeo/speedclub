<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A GET stores its whole URL in the session as _previous, and /sanctum/csrf-cookie and /admin/login start a session for anyone, so a
 * long query is a large row per request (SEC-P1-47). No link of ours comes near the limit: reset links carry their data in the
 * fragment or a short address, and the QA overrides of the Blade pages are a few bytes.
 *
 * It sits in the web group, ahead of the session, and only where a session starts: PublicPages takes it off the pages without one. On
 * the API a long query is no row either: without the session cookie there is no session, and with it StartSessionWithoutUrl stores no URL.
 */
final class RefuseLongQuery
{
    private const MAX_BYTES = 1024;

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        return strlen($request->server->getString('QUERY_STRING')) > self::MAX_BYTES
            ? new Response('', Response::HTTP_REQUEST_URI_TOO_LONG)
            : $next($request);
    }
}
