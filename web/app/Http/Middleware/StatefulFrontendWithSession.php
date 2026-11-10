<?php

namespace App\Http\Middleware;

use Illuminate\Http\Request;
use Illuminate\Session\Middleware\StartSession;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

/**
 * Sanctum's stateful middleware starts a session for any request with a first-party Referer or Origin, so an anonymous
 * browse of the catalogue got a cookie and a sessions row with IP address and user agent (SEC-105).
 *
 * Here a session only runs if the request already carries the session cookie. No signed-in browser loses anything: without
 * the cookie there is no signed-in member to protect, and with it the full chain including CSRF applies.
 *
 * For M1.5: the SPA calls GET /sanctum/csrf-cookie right before login and registration, never at app start, because that
 * is the request that creates the session. A cookie login route must answer 419 when $request->hasSession() is false.
 *
 * That chain stores no URL in the session (SEC-P1-49, see StartSessionWithoutUrl).
 */
class StatefulFrontendWithSession extends EnsureFrontendRequestsAreStateful
{
    /**
     * @param  Request  $request
     * @return bool
     */
    public static function fromFrontend($request)
    {
        return $request->cookies->has(config()->string('session.cookie')) && parent::fromFrontend($request);
    }

    /**
     * @return array<int, mixed>
     */
    protected function frontendMiddleware()
    {
        return array_map(
            fn (mixed $middleware): mixed => $middleware === StartSession::class ? StartSessionWithoutUrl::class : $middleware,
            parent::frontendMiddleware(),
        );
    }
}
