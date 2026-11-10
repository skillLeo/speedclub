<?php

use App\Http\Middleware\RefuseLongQuery;
use Illuminate\Http\Request;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

it('serves a guest without a session row and without cookies', function () {
    config(['session.driver' => 'database']);

    $response = $this->get('/')->assertOk();

    expect($response->headers->getCookies())->toBe([])
        ->and(DB::table('sessions')->count())->toBe(0);
});

it('takes a long campaign link, there is no session row to protect', function (string $path) {
    config(['session.driver' => 'database']);

    $this->get($path.'?utm_content='.str_repeat('a', 7500))->assertOk();

    expect(DB::table('sessions')->count())->toBe(0);
})->with(['landing page' => '/', 'robots' => '/robots.txt']);

it('refuses a long query exactly where a session starts', function () {
    foreach (Route::getRoutes()->getRoutes() as $route) {
        $middleware = app('router')->gatherRouteMiddleware($route);

        expect(in_array(RefuseLongQuery::class, $middleware, true))->toBe(in_array(StartSession::class, $middleware, true), $route->uri());
    }
});

// A long path gets past RefuseLongQuery. StartSession stores it as _previous on a matched route, also for a guest who is sent away, so a
// GET route with a parameter and a session needs its own answer to SEC-P1-47 first. The admin record pages (M3.2) and the admin
// fallback (DQ-507) answer it with bounded patterns (a ULID, a username, an 8-character code, at most 200 characters for the fallback):
// a path with a 1,000-character segment matches none of them, so no route stores it.
it('has no GET route with a session that matches an over-long path', function () {
    foreach (Route::getRoutes()->getRoutes() as $route) {
        if (! in_array('GET', $route->methods(), true) || ! in_array(StartSession::class, app('router')->gatherRouteMiddleware($route), true)) {
            continue;
        }

        if ($route->parameterNames() === []) {
            continue;
        }

        $long = '/'.preg_replace('/\{[^}]+\}/', str_repeat('a', 1000), $route->uri());
        expect($route->matches(Request::create($long)))->toBeFalse($route->uri().' matches a path of '.strlen($long).' characters');
        expect(str_starts_with($route->uri(), 'admin/'))->toBeTrue($route->uri().': only the admin bounds its parameters so far');
    }
});

it('starts no session on any public page', function () {
    // Everything on the web group outside the areas that need a session: staff portal and SPA login handshake.
    $routes = collect(Route::getRoutes()->getRoutes())
        ->filter(fn (RoutingRoute $route): bool => in_array('web', $route->middleware(), true)
            && ! preg_match('~^(admin|sanctum|docs/api|broadcasting)(/|$)~', $route->uri()));

    expect($routes->map(fn (RoutingRoute $route): string => $route->uri())->values()->all())->toContain('/');

    foreach ($routes as $route) {
        expect(app('router')->gatherRouteMiddleware($route))->not->toContain(StartSession::class, $route->uri());
    }
});
