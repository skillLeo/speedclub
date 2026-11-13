<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Auth\RecentAuthentication;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 09 §8.1 "sudo mode": `recent.auth:10` (alias registered by the lead; until then RequireRecentAuthentication::class.':10'). Without a
 * sign-in or POST me/reauth on this token or session within the minutes: 403 reauthentication_required with `methods`.
 *
 * The second parameter `or-password` is for the M2.5 endpoints that check the password in their own body (e-mail, password, two-factor
 * off, sessions, export, deletion): a member who has a password may still send it there instead, as older app builds do; a member
 * without one (passwordless account) needs the recent proof, and with it may leave the password out (Reauthentication::password()).
 */
class RequireRecentAuthentication
{
    public function __construct(private readonly RecentAuthentication $recent) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next, ?string $minutes = null, ?string $mode = null): Response
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::Unauthenticated);
        }

        $window = is_numeric($minutes) ? (int) $minutes : null;

        if ($this->recent->isRecent($user, $request, $window)) {
            return $next($request);
        }

        if ($mode === 'or-password' && $user->hasPassword()) {
            return $next($request);
        }

        SetLocaleFromHeader::apply($request);

        throw new ApiException(ErrorCode::ReauthenticationRequired, data: ['methods' => RecentAuthentication::methods($user)]);
    }
}
