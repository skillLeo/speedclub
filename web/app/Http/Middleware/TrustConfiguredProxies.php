<?php

namespace App\Http\Middleware;

use Illuminate\Http\Middleware\TrustProxies;

/**
 * Reads the proxies from config at request time; bootstrap/app.php runs before config exists.
 */
class TrustConfiguredProxies extends TrustProxies
{
    /**
     * @return array<int, string>|string|null
     */
    protected function proxies()
    {
        /** @var list<string> $proxies */
        $proxies = config()->array('speedclub.trusted_proxies', []);

        return match (true) {
            $proxies === [] => parent::proxies(),
            in_array('*', $proxies, true) => '*',
            default => $proxies,
        };
    }
}
