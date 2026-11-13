<?php

namespace App\Http\Controllers\Api\V1\Security;

use App\Actions\Security\ManageProviders;
use App\Enums\ErrorCode;
use App\Enums\SocialProvider;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Security\LinkProviderRequest;
use App\Http\Resources\V1\SocialAccountResource;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class ProviderController extends Controller
{
    /**
     * My linked sign-in providers.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $user = $this->member($request);

        return SocialAccountResource::collection($user->socialAccounts()->orderBy('provider')->get());
    }

    /**
     * Link Apple or Google.
     *
     * Needs the provider's flag (404 `feature_disabled`), a verified address (403 `email_not_verified`) and a recent sign-in or POST
     * me/reauth (403 `reauthentication_required`). A fresh ID token as at sign-in, with its nonce from POST auth/nonce in `raw_nonce`; one that fails: 401 `invalid_identity_token`. Already linked to another account: 409
     * `provider_already_linked`; another ID of the same provider on this account: 409 `conflict`. Mails the owner.
     */
    public function store(LinkProviderRequest $request, ManageProviders $action, FeatureFlags $flags): SocialAccountResource
    {
        $user = $this->member($request);
        $provider = $request->provider();

        if (! $flags->enabled($provider->flag())) {
            throw new ApiException(ErrorCode::FeatureDisabled);
        }

        return new SocialAccountResource($action->link($user, $provider, $request->string('id_token')->toString(), $request->optional('raw_nonce'), $request->optional('authorization_code')));
    }

    /**
     * Unlink Apple or Google.
     *
     * Recent authentication. Allowed only while another way in remains (password, passkey, another provider, or an address that is not
     * an Apple private relay): 409 `last_sign_in_method`. Apple's authorisation is revoked when the server has the key. Mails the owner.
     */
    public function destroy(Request $request, string $provider, ManageProviders $action): Response
    {
        $user = $this->member($request);
        $kind = SocialProvider::tryFrom($provider) ?? throw new ApiException(ErrorCode::NotFound);

        $action->unlink($user, $kind);

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
