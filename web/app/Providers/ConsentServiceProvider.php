<?php

namespace App\Providers;

use App\Http\Middleware\EnsureCurrentConsent;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Contracts\Http\Kernel as KernelContract;
use Illuminate\Foundation\Http\Kernel;
use Illuminate\Routing\Router;
use Illuminate\Support\ServiceProvider;

/**
 * ADR-245: EnsureCurrentConsent joins the `member` middleware group (defined in AppServiceProvider, ADR-137), so every authenticated
 * member route, also one added later, refuses writes while a re-consent is outstanding. In the priority list right after
 * authentication, so it answers before route bindings and limiters (a refused write spends no attempt). Registered from here so
 * bootstrap/app.php stays the lead's; listed after AppServiceProvider in bootstrap/providers.php, so the group exists when this boots.
 */
class ConsentServiceProvider extends ServiceProvider
{
    public function boot(Router $router): void
    {
        $router->pushMiddlewareToGroup('member', EnsureCurrentConsent::class);

        $this->callAfterResolving(KernelContract::class, function (Kernel $kernel): void {
            $kernel->addToMiddlewarePriorityAfter(AuthenticatesRequests::class, EnsureCurrentConsent::class);
        });
    }
}
