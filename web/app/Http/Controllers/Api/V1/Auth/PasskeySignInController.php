<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\Passkeys\SignInWithPasskey;
use App\Enums\PasskeyCeremony;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Auth\PasskeySignInRequest;
use App\Http\Resources\V1\PasskeyOptionsResource;
use App\Http\Resources\V1\PasswordlessSessionResource;
use App\Services\Auth\Passkeys\MemberWebAuthn;

class PasskeySignInController extends Controller
{
    /**
     * Passkey sign-in options.
     *
     * Behind the flag `auth.passkeys`. Usernameless: no `allowCredentials`, user verification required. Pass `options` to the
     * platform's passkey prompt and send the result with `ceremony_id` to POST auth/passkeys/verify within 5 minutes.
     *
     * @unauthenticated
     */
    public function options(MemberWebAuthn $webauthn): PasskeyOptionsResource
    {
        return new PasskeyOptionsResource($webauthn->beginAssertion(PasskeyCeremony::Authentication));
    }

    /**
     * Sign in with a passkey.
     *
     * Checks the assertion against the stored passkey (origin, RP ID, challenge, signature, user verification, counter) and signs in its
     * owner with a token for `device_name`, or the web session. No two-factor step. Anything that fails, a spent or expired ceremony and
     * a counter that went back (reported to the owner): 422 `passkey_invalid`.
     *
     * @unauthenticated
     */
    public function verify(PasskeySignInRequest $request, SignInWithPasskey $action): PasswordlessSessionResource
    {
        return new PasswordlessSessionResource($action->handle($request->string('ceremony_id')->toString(), $request->credential(), $request->device(), $request));
    }
}
