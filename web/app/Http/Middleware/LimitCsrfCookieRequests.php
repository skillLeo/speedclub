<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Support\ClientAddress;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * SEC-P1-53: every GET /sanctum/csrf-cookie from a client without a cookie writes a session row, and the route sits outside /api, so
 * no API limiter reached it. This limit runs ahead of StartSession (FortifyServiceProvider puts it on Sanctum's route and pins the
 * priority): past speedclub.rate_limits.csrf_cookie per client (IPv6 by /64) the answer is 429 and no row is written.
 */
final class LimitCsrfCookieRequests
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $key = 'csrf-cookie:'.ClientAddress::key($request);
        $max = config()->integer('speedclub.rate_limits.csrf_cookie.max');

        if (RateLimiter::tooManyAttempts($key, $max)) {
            $seconds = max(1, RateLimiter::availableIn($key));
            $code = ErrorCode::RateLimited;

            return new JsonResponse(
                ['message' => $code->message(), 'code' => $code->value, 'errors' => (object) []],
                $code->status(),
                ['Retry-After' => (string) $seconds, 'Cache-Control' => 'no-store'],
            );
        }

        RateLimiter::hit($key, config()->integer('speedclub.rate_limits.csrf_cookie.minutes') * 60);

        return $next($request);
    }
}
