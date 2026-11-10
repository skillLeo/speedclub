<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\RequestPasswordReset;
use App\Actions\Auth\ResetMemberPassword;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Auth\EmailOnlyRequest;
use App\Http\Requests\Api\V1\Auth\ResetPasswordRequest;
use App\Http\Resources\V1\NextStepResource;

class PasswordResetController extends Controller
{
    /**
     * Request a password reset code.
     *
     * Always the same 202. The e-mail holds a six-digit code and a link to /app/reset-password, with code and address in
     * the fragment (#code=...&email=...). Nothing is sent during the cooldown, above five codes an hour or ten in 24 hours.
     *
     * @unauthenticated
     */
    public function forgot(EmailOnlyRequest $request, RequestPasswordReset $action): NextStepResource
    {
        /** @status 202 */
        return new NextStepResource($action->handle($request->email()));
    }

    /**
     * Set a new password with the code.
     *
     * Ends all tokens and sessions of the account and issues no new auth: `next` is `sign_in`. A wrong, unknown, used or
     * expired code answers 422 `invalid_code`.
     *
     * @unauthenticated
     */
    public function reset(ResetPasswordRequest $request, ResetMemberPassword $action): NextStepResource
    {
        return new NextStepResource($action->handle(
            $request->email(),
            $request->string('code')->toString(),
            $request->string('password')->toString(),
        ));
    }
}
