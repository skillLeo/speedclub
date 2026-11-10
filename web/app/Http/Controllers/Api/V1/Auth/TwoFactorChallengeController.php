<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\PassTwoFactorChallenge;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Auth\TwoFactorChallengeRequest;
use App\Http\Resources\V1\AuthSessionResource;

class TwoFactorChallengeController extends Controller
{
    /**
     * Finish a sign-in with two-factor (AUTH-11).
     *
     * `challenge` comes from auth/login or auth/email/verify (`two_factor_required: true`). Send `code` (six digits from the
     * authenticator app) or `recovery_code`; a recovery code is spent. The device fields work as at sign-in: with `device_name` a token,
     * without it the SPA session (419 without GET /sanctum/csrf-cookie first). A wrong code: 422 on `code` or `recovery_code`; 5 wrong
     * codes a minute per challenge and account: 429. An unknown, spent or expired challenge (5 minutes): 422 `challenge_expired`, start
     * the sign-in again. The answer is the normal sign-in answer, and the forced password change and the restriction answers apply here.
     *
     * @unauthenticated
     */
    public function store(TwoFactorChallengeRequest $request, PassTwoFactorChallenge $action): AuthSessionResource
    {
        $code = $request->validated('code');
        $recovery = $request->validated('recovery_code');

        return new AuthSessionResource($action->handle(
            $request->string('challenge')->toString(),
            is_string($code) ? $code : null,
            is_string($recovery) ? $recovery : null,
            $request->device(),
            $request,
        ));
    }
}
