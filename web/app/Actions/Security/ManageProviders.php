<?php

namespace App\Actions\Security;

use App\Enums\ErrorCode;
use App\Enums\SocialProvider;
use App\Exceptions\ApiException;
use App\Models\SocialAccount;
use App\Models\User;
use App\Services\Auth\IdTokens\IdTokenVerifier;
use App\Services\Auth\IdTokens\SocialAccounts;
use App\Services\Auth\SignInMethods;

/**
 * POST and DELETE me/providers (09 §8.1, recent auth). Linking from the settings needs a fresh ID token of the provider: the signed-in,
 * recently proved member links it to themselves. A subject that belongs to another account answers 409 provider_already_linked.
 * Unlinking keeps at least one way in (409 last_sign_in_method) and revokes Apple's refresh token.
 */
class ManageProviders
{
    public function __construct(
        private readonly IdTokenVerifier $verifier,
        private readonly SocialAccounts $social,
        private readonly SignInMethods $methods,
    ) {}

    public function link(User $user, SocialProvider $provider, string $idToken, ?string $rawNonce, ?string $authorizationCode): SocialAccount
    {
        // SEC-M46-01, also behind the route's verified-member: an unproved address may be a stranger's pre-registration.
        if (! $user->hasVerifiedEmail()) {
            throw new ApiException(ErrorCode::EmailNotVerified);
        }

        $identity = $this->verifier->verify($provider, $idToken, $rawNonce);

        if ($user->socialAccounts()->where('provider', $provider)->exists() && $this->social->find($identity)?->user_id !== $user->id) {
            throw new ApiException(ErrorCode::Conflict);
        }

        return $this->social->link($user, $identity, notify: true, authorizationCode: $authorizationCode);
    }

    public function unlink(User $user, SocialProvider $provider): void
    {
        $account = $user->socialAccounts()->where('provider', $provider)->first();

        if ($account === null) {
            throw new ApiException(ErrorCode::NotFound);
        }

        if (! $this->methods->remainWithout($user, $account)) {
            throw new ApiException(ErrorCode::LastSignInMethod);
        }

        $this->social->unlink($user, $account);
    }
}
