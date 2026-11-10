<?php

namespace App\Http\Controllers\Admin\Errors;

use App\Http\Controllers\Admin\Support\AdminLocale;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\RestrictAdminAccess;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;
use Tighten\Ziggy\BladeRouteGenerator;

/**
 * ADM-05: 403, 404, 419, 500 and 503 inside /admin as the Inertia page "Error" instead of the framework's HTML, so an Inertia visit
 * shows a real page (with the shell for signed-in staff) and not a modal with raw HTML. JSON clients keep their JSON.
 *
 * transform() runs inside HandleInertiaRequests for errors raised by an admin route. respond() is for bootstrap/app.php
 * (withExceptions → respond) and covers what happens before the route runs: unknown URL, CSRF, maintenance.
 */
final class AdminErrorPage
{
    public const STATUSES = [400, 403, 404, 419, 429, 500, 503];

    /** Request attribute: this request's error page is already the Inertia page (respond() ran before HandleInertiaRequests). */
    private const RENDERED = 'admin_error_page_rendered';

    public static function transform(Request $request, Response $response): Response
    {
        if (! self::applies($request, $response)) {
            return $response;
        }

        $status = $response->getStatusCode();
        $request->attributes->set(self::RENDERED, true);

        // The root view prints Ziggy's routes once per request (`const Ziggy = …`, later `Object.assign(Ziggy.routes, …)`); whatever
        // was rendered before is thrown away here, so this page must print the declaration itself.
        BladeRouteGenerator::$generated = false;

        return Inertia::render('Error', ['status' => $status])
            ->toResponse($request)
            ->setStatusCode($status);
    }

    /**
     * For errors that never reached HandleInertiaRequests. Shares the same props, so the page knows the staff member and locale.
     */
    public static function respond(Request $request, Response $response): Response
    {
        if (! self::applies($request, $response)) {
            return $response;
        }

        AdminLocale::apply($request);
        $middleware = app(HandleInertiaRequests::class);
        Inertia::version(fn (): ?string => $middleware->version($request));
        Inertia::setRootView($middleware->rootView($request));
        Inertia::share($middleware->share($request));

        return self::transform($request, $response);
    }

    private static function applies(Request $request, Response $response): bool
    {
        if ($request->attributes->get(self::RENDERED) === true) {
            return false;
        }

        if (! $request->is('admin', 'admin/*') || ! in_array($response->getStatusCode(), self::STATUSES, true)) {
            return false;
        }

        // SEC-P3-04: a client the access fence refuses keeps its bare 404: no admin page, no route list.
        if (! RestrictAdminAccess::allows($request)) {
            return false;
        }

        // Already an Inertia page, a JSON answer, or a JSON client.
        if ($response->headers->has('X-Inertia') || str_contains((string) $response->headers->get('Content-Type'), 'json')) {
            return false;
        }

        if ($request->expectsJson() && ! $request->header('X-Inertia')) {
            return false;
        }

        // A developer keeps the framework's trace for a 500.
        return ! ($response->getStatusCode() === 500 && config('app.debug') === true);
    }
}
