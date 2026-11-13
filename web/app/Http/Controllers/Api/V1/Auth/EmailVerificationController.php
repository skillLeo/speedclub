<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\Passwordless\SignInWithEmailCode;
use App\Actions\Auth\Passwordless\StartEmailSignIn;
use App\Actions\Auth\ResendVerificationCode;
use App\Actions\Auth\VerifyMemberEmail;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Auth\EmailOnlyRequest;
use App\Http\Requests\Api\V1\Auth\StartEmailCodeRequest;
use App\Http\Requests\Api\V1\Auth\VerifyEmailRequest;
use App\Http\Resources\V1\AuthSessionResource;
use App\Http\Resources\V1\EmailCodeStartedResource;
use App\Http\Resources\V1\NextStepResource;
use App\Http\Resources\V1\PasswordlessSessionResource;
use App\Http\Resources\V1\TwoFactorChallengeResource;
use App\Support\Auth\AuthResult;
use App\Support\Auth\PasswordlessResult;

class EmailVerificationController extends Controller
{
    /**
     * Ask for a sign-in code (AUTH-12, passwordless).
     *
     * Always 202 `{attempt_id, resend_after}`, with the same body and duration whether or not the address has an account. `attempt_id` is
     * made by the app (a UUID) and kept on the device; send it again with the code to POST auth/email/verify. The mail holds the 6-digit
     * code (10 minutes, single use) and an "Anmelden" button that works only on this device. Nothing is sent during the cooldown
     * (`resend_after`: 30 s, 60 s, then 120 s), above 5 codes an hour for the address, or while it is locked after 10 wrong codes.
     *
     * @unauthenticated
     */
    public function start(StartEmailCodeRequest $request, StartEmailSignIn $action): EmailCodeStartedResource
    {
        /** @status 202 */
        return new EmailCodeStartedResource($action->handle(
            $request->email(),
            $request->attemptId(),
            $request->optionalString('locale'),
            $request->optionalString('platform'),
            $request,
        ));
    }

    /**
     * Confirm the e-mail address and sign in.
     *
     * **With `attempt_id` (AUTH-13, passwordless):** the `code` or the `magic_token` of the mail's link signs in; an address without an
     * account gets one (`is_new: true`, `next: terms` until POST me/onboarding/accept). Wrong code: 422 `invalid_code` with
     * `attempts_left`; expired: 422 `code_expired`; 10 wrong codes in an hour: 429 `email_code_locked` with `retry_after` (15 minutes,
     * and a security mail to the account). With two-factor on the answer is the challenge, as at sign-in.
     *
     * **Without `attempt_id` (registration with a password):**
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
    public function verify(VerifyEmailRequest $request, VerifyMemberEmail $action, SignInWithEmailCode $passwordless): AuthSessionResource|PasswordlessSessionResource|TwoFactorChallengeResource
    {
        if ($request->isPasswordless()) {
            $signedIn = $passwordless->handle(
                $request->email(),
                $request->string('attempt_id')->toString(),
                $request->optionalString('code'),
                $request->optionalString('magic_token'),
                $request->optionalString('locale'),
                $request->device(),
                $request,
            );

            return $signedIn instanceof PasswordlessResult ? new PasswordlessSessionResource($signedIn) : new TwoFactorChallengeResource($signedIn);
        }

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
