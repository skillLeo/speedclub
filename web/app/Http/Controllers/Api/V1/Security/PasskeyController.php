<?php

namespace App\Http\Controllers\Api\V1\Security;

use App\Actions\Auth\Passkeys\RegisterMemberPasskey;
use App\Actions\Security\ManagePasskeys;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Security\RenamePasskeyRequest;
use App\Http\Requests\Api\V1\Security\StorePasskeyRequest;
use App\Http\Resources\V1\PasskeyOptionsResource;
use App\Http\Resources\V1\PasskeyResource;
use App\Models\MemberPasskey;
use App\Models\User;
use App\Services\Auth\Passkeys\MemberWebAuthn;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class PasskeyController extends Controller
{
    /**
     * My passkeys.
     *
     * Newest first, at most 20. Each row names its provider from the AAGUID.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $user = $this->member($request);

        return PasskeyResource::collection($user->memberPasskeys()->latest('created_at')->latest('id')->get());
    }

    /**
     * Passkey registration options.
     *
     * Behind `auth.passkeys`; needs a verified address (403 `email_not_verified`) and a recent sign-in or POST me/reauth (403
     * `reauthentication_required`). Discoverable credential, user verification required, attestation none, the member's passkeys
     * excluded. Send the result with `ceremony_id` to POST me/passkeys.
     */
    public function options(Request $request, MemberWebAuthn $webauthn): PasskeyOptionsResource
    {
        return new PasskeyOptionsResource($webauthn->beginRegistration($this->member($request)));
    }

    /**
     * Add a passkey.
     *
     * Behind `auth.passkeys`; a verified address (403 `email_not_verified`) and recent authentication. A response that fails (origin, RP ID, challenge, spent or expired ceremony, a
     * credential already stored): 422 `passkey_invalid`. More than 20: 409 `conflict`. Mails the owner.
     */
    public function store(StorePasskeyRequest $request, RegisterMemberPasskey $action): PasskeyResource
    {
        $user = $this->member($request);
        $name = $request->validated('name');

        return new PasskeyResource($action->handle($user, $request->string('ceremony_id')->toString(), $request->credential(), is_string($name) ? $name : null));
    }

    /**
     * Rename a passkey.
     *
     * Recent authentication. Another member's passkey: 404.
     */
    public function update(RenamePasskeyRequest $request, MemberPasskey $memberPasskey, ManagePasskeys $action): PasskeyResource
    {
        $user = $this->member($request);
        Gate::authorize('update', $memberPasskey);

        return new PasskeyResource($action->rename($user, $memberPasskey, $request->string('name')->toString()));
    }

    /**
     * Remove a passkey.
     *
     * Recent authentication. The last way into the account cannot go: 409 `last_sign_in_method`. Mails the owner. The passkey stays in
     * the password manager until the member deletes it there.
     */
    public function destroy(Request $request, MemberPasskey $memberPasskey, ManagePasskeys $action): Response
    {
        $user = $this->member($request);
        Gate::authorize('delete', $memberPasskey);

        $action->remove($user, $memberPasskey);

        return response()->noContent();
    }

    private function member(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('update', $user);

        return $user;
    }
}
