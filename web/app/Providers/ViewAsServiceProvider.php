<?php

namespace App\Providers;

use App\Http\Middleware\RestrictViewAs;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Contracts\Http\Kernel as KernelContract;
use Illuminate\Foundation\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

/**
 * View-as (M3.2, m3.2-contract §3): RestrictViewAs on the whole `api` group, ahead of authentication, route bindings and limiters, so a
 * view-as token can neither write nor read messages on any route, also one added later. Registered from here so bootstrap/app.php stays
 * the lead's. The `view-as` limiter guards its one write, DELETE api/v1/view-as.
 */
class ViewAsServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->callAfterResolving(KernelContract::class, function (Kernel $kernel): void {
            $kernel->appendMiddlewareToGroup('api', RestrictViewAs::class);
            $kernel->addToMiddlewarePriorityBefore(AuthenticatesRequests::class, RestrictViewAs::class);
        });

        RateLimiter::for('view-as', fn (Request $request): Limit => Limit::perMinute(30)->by('view-as:'.hash('sha256', (string) $request->bearerToken())));
    }
}
