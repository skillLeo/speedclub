<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\ResendVerificationCode;
use App\Actions\Auth\VerifyMemberEmail;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Auth\EmailOnlyRequest;
use App\Http\Requests\Api\V1\Auth\VerifyEmailRequest;
use App\Http\Resources\V1\AuthSessionResource;
use App\Http\Resources\V1\NextStepResource;
use App\Http\Resources\V1\TwoFactorChallengeResource;
use App\Support\Auth\AuthResult;

class EmailVerificationController extends Controller
{
    /**
     * Confirm the e-mail address and sign in.
     *
     * Needs the code and `password`, the password chosen at registration. A request already signed in as this account
     * (an unverified member may sign in) leaves `password` out. With `device_name` the answer holds a token for that
     * device, and `device_id` (the app's per-install id) tells two devices of the same model apart, as at sign-in.
     * Without `device_name` the SPA session is signed in, which needs GET /sanctum/csrf-cookie first (419 otherwise). A wrong,
     * unknown, used or expired code and a password that does not match all answer 422 `invalid_code`; someone whose
     * password does not match uses forgot password. Success ends every earlier token and session of the account. A member
     * who must change the password is verified but not signed in: 403 `password_change_required`, and a reset code is on
     * its way. An account with two-factor answers `{two_factor_required: true, challenge, expires_in}` as at sign-in.
     *
     * @unauthenticated
     */
    public function verify(VerifyEmailRequest $request, VerifyMemberEmail $action): AuthSessionResource|TwoFactorChallengeResource
    {
        $result = $action->handle(
            $request->email(),
            $request->string('code')->toString(),
            $request->password(),
            $request->signedInMember(),
            $request->device(),
            $request,
        );

        return $result instanceof AuthResult ? new AuthSessionResource($result) : new TwoFactorChallengeResource($result);
    }

    /**
     * Send a new code.
     *
     * Always the same 202. Nothing is sent during the cooldown of `resend_after_seconds`, above five codes an hour or ten in 24 hours,
     * or for an address without an open verification.
     *
     * @unauthenticated
     */
    public function resend(EmailOnlyRequest $request, ResendVerificationCode $action): NextStepResource
    {
        /** @status 202 */
        return new NextStepResource($action->handle($request->email()));
    }
}
