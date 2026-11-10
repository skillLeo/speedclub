<?php

namespace App\Http\Middleware;

use App\Actions\Auth\DemandPasswordChange;
use App\Models\User;
use App\Support\ViewAs;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 403 password_change_required on every authenticated route, for tokens and sessions issued before the flag was set
 * (ADR-137). Part of the `member` middleware group. The allow-list is short: auth/logout uses plain auth:sanctum, and
 * the reset flow is public.
 */
class EnsurePasswordCurrent
{
    public function __construct(private readonly DemandPasswordChange $demand) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user instanceof User && $user->getAttribute('force_password_change') === true) {
            // A view-as request (M3.2) is staff looking: it refuses the same, but must not send the member a reset code.
            if (ViewAs::active()) {
                throw DemandPasswordChange::refusal($user);
            }

            $this->demand->onLiveSignIn($user);
        }

        return $next($request);
    }
}
