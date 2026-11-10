<?php

namespace App\Http\Middleware;

use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Session\SessionManager;

/**
 * The session of the API chain, without the one thing it has no use for: StartSession stores the full URL of a GET as _previous, on
 * every answer including a 401 and a limiter's 429, so a session cookie plus a long URL was a large row per request (SEC-P1-49). The API
 * answers JSON and never redirects back, so nothing there reads _previous. The web group keeps it: the staff forms go back().
 */
final class StartSessionWithoutUrl extends StartSession
{
    /**
     * The container only builds the parent with this resolver, and a route with block() needs it.
     */
    public function __construct(SessionManager $manager)
    {
        parent::__construct($manager, fn (): CacheFactory => app(CacheFactory::class));
    }

    protected function storeCurrentUrl(Request $request, $session): void {}
}
