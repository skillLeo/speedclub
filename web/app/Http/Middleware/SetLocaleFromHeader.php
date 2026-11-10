<?php

namespace App\Http\Middleware;

use App\Services\Privacy\OrgIdentity;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * API locale from Accept-Language; anything unsupported falls back to the org's default locale (ADM-52, de unless set).
 */
class SetLocaleFromHeader
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $locale = self::apply($request);

        $response = $next($request);
        $response->headers->set('Content-Language', $locale);
        $response->setVary('Accept-Language', false);

        return $response;
    }

    public static function apply(Request $request): string
    {
        // ADR-239: without a matching Accept-Language the org's default locale (ADM-52), not always the first configured one.
        $locale = app(OrgIdentity::class)->forRequest($request);
        app()->setLocale($locale);

        return $locale;
    }
}
