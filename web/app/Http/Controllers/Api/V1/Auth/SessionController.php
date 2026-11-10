<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\LoginMember;
use App\Actions\Auth\LogoutMember;
use App\Actions\Auth\RotateMemberToken;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Auth\LoginRequest;
use App\Http\Requests\Api\V1\Auth\RotateTokenRequest;
use App\Http\Resources\V1\AuthSessionResource;
use App\Http\Resources\V1\MeResource;
use App\Http\Resources\V1\TwoFactorChallengeResource;
use App\Models\User;
use App\Support\Auth\AuthResult;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class SessionController extends Controller
{
    /**
     * Sign in.
     *
     * With `device_name` the answer holds a token for that device, replacing its old one. `device_id`, the app's per-install id
     * (8 to 64 letters, digits and dashes, e.g. a UUID), tells two devices of the same model apart: with it, only the token of that
     * install is replaced; without it, the token with the same `device_name` and `platform`. Without `device_name` the SPA session is
     * signed in, which needs GET /sanctum/csrf-cookie first (419 otherwise). Wrong password or unknown address: 401
     * `invalid_credentials`. Repeated failures: 429 with Retry-After. Suspended: 403 `account_restricted`. New password
     * needed: 403 `password_change_required`, and a reset code is on its way. An unverified member does get in;
     * `next_step` says where to resume. An account with two-factor gets `{two_factor_required: true, challenge, expires_in}` instead
     * of a session or token: send the challenge with a code to POST auth/two-factor/challenge (AUTH-11). A closed account (deletion
     * requested) answers 401 `invalid_credentials` like a wrong password.
     *
     * @unauthenticated
     */
    public function login(LoginRequest $request, LoginMember $action): AuthSessionResource|TwoFactorChallengeResource
    {
        $result = $action->handle(
            $request->email(),
            $request->string('password')->toString(),
            $request->device(),
            $request,
        );

        return $result instanceof AuthResult ? new AuthSessionResource($result) : new TwoFactorChallengeResource($result);
    }

    /**
     * Sign out this device or browser.
     *
     * Stays open for a member who must change the password.
     */
    public function logout(Request $request, LogoutMember $action): Response
    {
        /** @var User $user */
        $user = $request->user();

        $action->handle($user, $request);

        return response()->noContent();
    }

    /**
     * Replace this device's token.
     *
     * Only for tokens older than seven days: 409 `token_rotation_not_due` with `retry_at` before that, 409 `conflict` for a
     * cookie session. The old token keeps working for two more minutes, so a lost answer does not end the session: sent again
     * with the old token, this revokes the unused new token and answers a fresh one. Once the new token has been used, the old
     * token answers 409 `conflict` here and stops working at once. After the two minutes it answers 401 like any expired token.
     * Send `device_id` as at sign-in: a token from before the app sent one takes it here, so its successor is that install's alone.
     */
    public function rotate(RotateTokenRequest $request, RotateMemberToken $action): AuthSessionResource
    {
        /** @var User $user */
        $user = $request->user();

        return new AuthSessionResource($action->handle($user, $request->deviceId()));
    }

    /**
     * The signed-in member.
     *
     * `next_step` is the first open onboarding step, or null when onboarding is done.
     */
    public function me(Request $request): MeResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('view', $user);

        return new MeResource($user);
    }
}
