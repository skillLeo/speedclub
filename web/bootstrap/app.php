<?php

use App\Exceptions\ApiExceptionRenderer;
use App\Exceptions\QueryExceptionReporter;
use App\Http\Controllers\Admin\Errors\AdminErrorPage;
use App\Http\Middleware\EnsureNotRestricted;
use App\Http\Middleware\EnsureVerified;
use App\Http\Middleware\ETag;
use App\Http\Middleware\ForceHttps;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\Idempotency;
use App\Http\Middleware\LimitJsonBody;
use App\Http\Middleware\RefuseLongQuery;
use App\Http\Middleware\RejectInvalidText;
use App\Http\Middleware\SecurityHeaders;
use App\Http\Middleware\SetLocaleFromHeader;
use App\Http\Middleware\StaffSession;
use App\Http\Middleware\StatefulFrontendWithSession;
use App\Http\Middleware\TrustConfiguredProxies;
use App\Http\OpenApi\ApiDocumentation;
use App\Http\RateLimits;
use App\Support\TrustedHosts;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Symfony\Component\HttpFoundation\Response;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function (): void {
            Route::middleware(['web', 'staff'])
                ->prefix('admin')
                ->name('admin.')
                ->group(base_path('routes/admin.php'));
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Ahead of everything that would read or clean the body (SEC-P1-46, SEC-P1-48).
        $middleware->prepend(LimitJsonBody::class);
        $middleware->trustHosts(at: TrustedHosts::patterns(...), subdomains: false);
        $middleware->replace(TrustProxies::class, TrustConfiguredProxies::class);
        $middleware->append(SecurityHeaders::class);
        $middleware->append(ForceHttps::class);
        $middleware->alias([
            'etag' => ETag::class,
            'idempotent' => Idempotency::class,
            'not-restricted' => EnsureNotRestricted::class,
            'verified-member' => EnsureVerified::class,
        ]);

        $middleware->web(prepend: [RefuseLongQuery::class]);

        // Replaces statefulApi(): same Sanctum middleware, but a session only for requests that already have one (SEC-105).
        $middleware->api(prepend: [StatefulFrontendWithSession::class], append: [SetLocaleFromHeader::class, RejectInvalidText::class]);

        $middleware->group('staff', [StaffSession::class, HandleInertiaRequests::class, RejectInvalidText::class]);
        $middleware->prependToPriorityList(StartSession::class, StaffSession::class);

        $middleware->redirectGuestsTo(fn (Request $request): string => $request->is('admin', 'admin/*')
            ? route('login')
            : url('/app'));
        $middleware->redirectUsersTo(fn (Request $request): string => $request->is('admin', 'admin/*')
            ? route('admin.dashboard')
            : url('/app'));
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontFlash(['token', 'code', 'recovery_code']);
        $exceptions->report(fn (QueryException $exception): ?bool => (new QueryExceptionReporter)->report($exception));
        $exceptions->render(fn (Throwable $exception, Request $request): ?Response => (new ApiExceptionRenderer)->render($exception, $request));
        // ADM-05: unknown /admin URLs, 419 and 503 render the admin error page inside the shell (AdminErrorPage decides).
        $exceptions->respond(fn (Response $response, Throwable $exception, Request $request): Response => AdminErrorPage::respond($request, $response));
    })
    ->booted(function (): void {
        RateLimits::register();
        ApiDocumentation::register();
    })
    ->create();
