<?php

namespace App\Http\Responses\Staff;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Laravel\Fortify\Contracts\LoginResponse;
use Laravel\Fortify\Contracts\LogoutResponse;
use Laravel\Fortify\Contracts\TwoFactorLoginResponse;
use Laravel\Fortify\Fortify;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sign-in, two-factor sign-in and sign-out of staff end in a **full page load** for Inertia requests (owner bug report 2026-11-16: an
 * empty admin sidebar after signing in, filled after a reload). The admin page's route list (`@routes` in app.blade.php) is rendered
 * only on a full load and, for a guest, holds the sign-in routes alone (SEC-P3-04); an Inertia visit after signing in kept that guest
 * list, so the sidebar, which hides every entry whose route the browser does not know, stayed empty. `Inertia::location` makes the
 * browser load the target page, which then carries the route list of the new state; after sign-out the staff routes leave the page.
 * Plain form posts and JSON callers keep Fortify's behaviour.
 */
final class StaffAuthChanged implements LoginResponse, LogoutResponse, TwoFactorLoginResponse
{
    /** @param bool $twoFactor bound for TwoFactorLoginResponse: JSON callers get Fortify's 204 there, 200 {two_factor: false} after a password sign-in */
    public function __construct(private readonly bool $twoFactor = false) {}

    public function toResponse($request): Response
    {
        /** @var Request $request */
        $signedOut = $request->user('staff') === null;

        if ($request->wantsJson() && ! $request->header('X-Inertia')) {
            return $signedOut || $this->twoFactor ? new JsonResponse('', 204) : new JsonResponse(['two_factor' => false]);
        }

        $target = $signedOut
            ? (string) Fortify::redirects('logout', '/admin/login')
            : (string) $request->session()->pull('url.intended', Fortify::redirects('login'));

        return $request->header('X-Inertia') ? Inertia::location($target) : redirect()->to($target);
    }
}
