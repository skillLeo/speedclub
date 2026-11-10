<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Me\ChangePassword;
use App\Actions\Me\ConfirmEmailChange;
use App\Actions\Me\RequestEmailChange;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\ChangeEmailRequest;
use App\Http\Requests\Api\V1\Me\ChangePasswordRequest;
use App\Http\Requests\Api\V1\Me\CodeRequest;
use App\Http\Resources\V1\EmailChangeResource;
use App\Http\Resources\V1\MeResource;
use App\Models\User;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class AccountSecurityController extends Controller
{
    /**
     * Change the e-mail address, step 1 (SET-03).
     *
     * Needs the current `password` (422 on `password` when wrong) and, with two-factor on, a current `code` (TOTP or recovery code;
     * missing: 422 `two_factor_code_required`, wrong: 422 on `code`). The same 202 whether or not the new address has an account: a free
     * address gets a six-digit code, valid 10 minutes; a taken one gets nothing, and its owner is told someone tried. Nothing is sent
     * during the cooldown of `resend_after_seconds` or above the code budget (5 an hour, 10 a day). 422 on `email` for the current
     * address.
     */
    public function requestEmail(ChangeEmailRequest $request, RequestEmailChange $action): EmailChangeResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        $cooldown = $action->handle($user, $request->email(), $request->string('password')->toString(), $request->filled('code') ? $request->string('code')->toString() : null);

        /** @status 202 */
        return new EmailChangeResource(['email' => $request->email(), 'resend_after_seconds' => $cooldown]);
    }

    /**
     * Change the e-mail address, step 2 (SET-03).
     *
     * The code from the mail to the new address. Switches the account to it (still verified) and mails the previous address. A wrong,
     * used or expired code: 422 `invalid_code`; nothing pending: 422 `invalid_code` with the reason. An address that has an account by
     * now, or had one when the code was asked for: 422 on `email`, "Diese Adresse kann nicht verwendet werden.", and the change ends.
     */
    public function confirmEmail(CodeRequest $request, ConfirmEmailChange $action): MeResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        return new MeResource($action->handle($user, $request->string('code')->toString()));
    }

    /**
     * Change the password (SET-04).
     *
     * `current_password` wrong: 422 on it. With two-factor on, a current `code` too (TOTP or recovery code; missing: 422
     * `two_factor_code_required`, wrong: 422 on `code`). The new `password` follows the policy of 02_PRODUCT_SPEC §3.1 (each broken rule its own
     * message) and must differ from the current one and the username. This device stays signed in. Other browsers are signed out by any
     * password change; with `revoke_other_sessions: true` the app on every other device too (its push tokens go with it). A security
     * mail and an in-app notice follow.
     */
    public function password(ChangePasswordRequest $request, ChangePassword $action): Response
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        $action->handle(
            $user,
            $request->string('current_password')->toString(),
            $request->string('password')->toString(),
            $request->boolean('revoke_other_sessions'),
            $request,
            $request->filled('code') ? $request->string('code')->toString() : null,
        );

        return response()->noContent();
    }
}
