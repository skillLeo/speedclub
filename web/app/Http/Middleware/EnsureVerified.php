<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 403 email_not_verified, which sends the client to AUTH-05 (02_PRODUCT_SPEC §3.1, ADR-139). Usage: verified-member.
 *
 * The rule: a route that puts something in front of other people carries this, so vehicle publish, follows, conversations
 * and messages. Everything open before verification goes without: browsing, the onboarding steps (username,
 * profile, images), drafts and their photos, catalogue requests from the add-vehicle wizard. No route of the first kind
 * exists before M1.6; tests/Feature/Auth/MemberAuthFindingsTest.php checks new ones by name. The policies refuse with
 * the same code.
 */
class EnsureVerified
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user instanceof User && ! $user->hasVerifiedEmail()) {
            throw new ApiException(ErrorCode::EmailNotVerified);
        }

        return $next($request);
    }
}
