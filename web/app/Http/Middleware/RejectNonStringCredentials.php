<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\Response;

/**
 * Fortify's steps validate these fields with at most `required`, then hand them to code that needs strings: an array answered 500,
 * and at the reset step only for a known address with a live link (SEC-P1-40). It sits on every Fortify route (config/fortify.php).
 *
 * ThrottleRequests runs ahead of it, so a limiter must not assume a string either (FortifyServiceProvider).
 */
final class RejectNonStringCredentials
{
    private const FIELDS = ['email', 'password', 'password_confirmation', 'current_password', 'token', 'code', 'recovery_code'];

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        Validator::make(Arr::only($request->input(), self::FIELDS), array_fill_keys(self::FIELDS, ['nullable', 'string']))->validate();

        return $next($request);
    }
}
