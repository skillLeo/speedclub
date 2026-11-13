<?php

namespace App\Http\Controllers\Api\V1\Security;

use App\Actions\Security\Reauthenticate;
use App\Actions\Security\StartReauthCode;
use App\Enums\PasskeyCeremony;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Security\AttemptRequest;
use App\Http\Requests\Api\V1\Security\ReauthRequest;
use App\Http\Resources\V1\EmailCodeStartedResource;
use App\Http\Resources\V1\PasskeyOptionsResource;
use App\Http\Resources\V1\ReauthResource;
use App\Models\User;
use App\Services\Auth\Passkeys\MemberWebAuthn;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class ReauthController extends Controller
{
    /**
     * Confirm it is me ("sudo mode").
     *
     * `method`: `passkey` (`ceremony_id` + `credential` from POST me/reauth/passkey-options), `email_code` (`attempt_id` + `code` from
     * POST me/reauth/email) or `password`. With two-factor on, `email_code` and `password` also need `two_factor_code`. Marks this token
     * or browser session for 10 minutes: changing the e-mail or password, passkeys, linked providers, switching two-factor off, signing
     * out everywhere, the data export and the deletion then go through. Wrong answers: 422 on the field (`passkey_invalid` for a passkey).
     */
    public function store(ReauthRequest $request, Reauthenticate $action): ReauthResource
    {
        $user = $this->member($request);

        return new ReauthResource($action->handle($user, $request->reauthMethod(), $request->proof(), $request));
    }

    /**
     * Send a confirmation code.
     *
     * A code to the account's address for POST me/reauth with `method: email_code`. Always 202 `{attempt_id, resend_after}`; nothing is
     * sent during the cooldown, above 5 codes an hour or during a lock.
     */
    public function email(AttemptRequest $request, StartReauthCode $action): EmailCodeStartedResource
    {
        $user = $this->member($request);

        /** @status 202 */
        return new EmailCodeStartedResource($action->handle($user, $request->string('attempt_id')->toString()));
    }

    /**
     * Passkey options for the confirmation.
     *
     * Lists the member's own passkeys as `allowCredentials`. Send the result to POST me/reauth with `method: passkey`.
     */
    public function passkeyOptions(Request $request, MemberWebAuthn $webauthn): PasskeyOptionsResource
    {
        $user = $this->member($request);

        return new PasskeyOptionsResource($webauthn->beginAssertion(PasskeyCeremony::Reauth, $user));
    }

    private function member(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        return $user;
    }
}
