<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Actions\Auth\Social\ConfirmProviderLink;
use App\Actions\Auth\Social\SignInWithProvider;
use App\Enums\ErrorCode;
use App\Enums\SocialProvider;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Auth\AppleSignInRequest;
use App\Http\Requests\Api\V1\Auth\ConfirmLinkRequest;
use App\Http\Requests\Api\V1\Auth\GoogleSignInRequest;
use App\Http\Requests\Api\V1\Auth\IdTokenNonceRequest;
use App\Http\Resources\V1\IdTokenNonceResource;
use App\Http\Resources\V1\LinkRequiredResource;
use App\Http\Resources\V1\PasswordlessSessionResource;
use App\Http\Resources\V1\TwoFactorChallengeResource;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Auth\IdTokens\IdTokenNonces;
use App\Support\Auth\LinkRequired;
use App\Support\Auth\PasswordlessResult;
use App\Support\Auth\TwoFactorPending;
use Illuminate\Http\JsonResponse;

class SocialSignInController extends Controller
{
    /**
     * A nonce for Apple or Google.
     *
     * Ask for one right before each Apple or Google sign-in or link (POST me/providers) and give it to the provider's SDK (Apple: its
     * SHA-256 hex). The ID token must carry it; it is spent by the first token and expires after 10 minutes. Behind the provider's flag
     * (404 `feature_disabled`).
     *
     * @unauthenticated
     */
    public function nonce(IdTokenNonceRequest $request, IdTokenNonces $nonces, FeatureFlags $flags): JsonResponse
    {
        $provider = $request->provider();

        if (! $flags->enabled($provider->flag())) {
            throw new ApiException(ErrorCode::FeatureDisabled);
        }

        return (new IdTokenNonceResource(['nonce' => $nonces->issue($provider), 'expires_in' => $nonces->ttlSeconds()]))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * Sign in with Apple.
     *
     * Behind the flag `auth.apple` (404 `feature_disabled` while off or without configured client IDs). `identity_token` is verified
     * against Apple's keys: issuer, audience (bundle ID or Services ID), expiry, RS256, and `nonce` = SHA-256 of `raw_nonce`. A linked
     * Apple ID signs in (no two-factor step, except once on an account with two-factor on for an ID never tied to it: then the AUTH-11
     * challenge, SEC-M46-02). An unknown one with the address of an existing account answers 202 `link_required`
     * (AUTH-16, a code went to that address); otherwise a new account is created (`is_new: true`, `next: terms`). `full_name` is stored
     * for a new account (Apple sends it only once). Any failed check: 401 `invalid_identity_token`.
     *
     * @unauthenticated
     */
    public function apple(AppleSignInRequest $request, SignInWithProvider $action): PasswordlessSessionResource|LinkRequiredResource|TwoFactorChallengeResource
    {
        return $this->answer($action->handle(SocialProvider::Apple, $request->signInInput(), $request->device(), $request));
    }

    /**
     * Sign in with Google.
     *
     * Behind the flag `auth.google` (404 `feature_disabled` while off or without configured client IDs). `id_token` from the Google SDK
     * or Google Identity Services is verified against Google's keys: issuer, audience (a configured client ID), expiry, RS256,
     * `email_verified`, and `nonce` (from POST auth/nonce, required, single use). Then as for Apple: sign in, 202 `link_required` (AUTH-16) or a new account.
     *
     * @unauthenticated
     */
    public function google(GoogleSignInRequest $request, SignInWithProvider $action): PasswordlessSessionResource|LinkRequiredResource|TwoFactorChallengeResource
    {
        return $this->answer($action->handle(SocialProvider::Google, $request->signInInput(), $request->device(), $request));
    }

    /**
     * Confirm a provider link (AUTH-16).
     *
     * `attempt_id` from the `link_required` answer and the 6-digit code mailed to the existing account. Links the provider, mails the
     * owner, and signs in (with two-factor on: the challenge, as at sign-in). Wrong code: 422 `invalid_code` with `attempts_left`;
     * expired: 422 `code_expired`; locked: 429 `email_code_locked`. A provider ID already linked elsewhere: 409 `provider_already_linked`.
     *
     * @unauthenticated
     */
    public function confirmLink(ConfirmLinkRequest $request, ConfirmProviderLink $action): PasswordlessSessionResource|TwoFactorChallengeResource
    {
        $result = $action->handle($request->string('attempt_id')->toString(), $request->string('code')->toString(), $request->device(), $request);

        return $result instanceof PasswordlessResult ? new PasswordlessSessionResource($result) : new TwoFactorChallengeResource($result);
    }

    private function answer(PasswordlessResult|LinkRequired|TwoFactorPending $result): PasswordlessSessionResource|LinkRequiredResource|TwoFactorChallengeResource
    {
        return match (true) {
            $result instanceof PasswordlessResult => new PasswordlessSessionResource($result),
            $result instanceof LinkRequired => new LinkRequiredResource($result),
            default => new TwoFactorChallengeResource($result),
        };
    }
}
