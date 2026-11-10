<?php

namespace App\Http\Middleware;

use App\Enums\RestrictionType;
use App\Exceptions\ApiException;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 403 account_restricted with the until-date (05_ARCHITECTURE §8). Usage: not-restricted:publishing or :messaging.
 */
class EnsureNotRestricted
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next, string $restriction): Response
    {
        $type = RestrictionType::from($restriction);
        $user = $request->user();

        if ($user instanceof User && $user->isRestrictedFrom($type)) {
            throw ApiException::accountRestricted($user->restrictedUntil($type));
        }

        return $next($request);
    }
}
