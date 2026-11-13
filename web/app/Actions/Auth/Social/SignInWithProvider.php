<?php

namespace App\Actions\Auth\Social;

use App\Actions\Auth\SignInMember;
use App\Enums\ErrorCode;
use App\Enums\LoginPurpose;
use App\Enums\MemberSecurityEvent;
use App\Enums\SignInMethod;
use App\Enums\SocialProvider;
use App\Exceptions\ApiException;
use App\Mail\EmailCodeMail;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\EmailCodes;
use App\Services\Auth\IdTokens\IdTokenVerifier;
use App\Services\Auth\IdTokens\SocialAccounts;
use App\Services\Auth\IdTokens\VerifiedIdentity;
use App\Services\Auth\PasswordlessAccounts;
use App\Support\Auth\DeviceInfo;
use App\Support\Auth\LinkRequired;
use App\Support\Auth\PasswordlessResult;
use App\Support\Auth\TwoFactorPending;
use App\Support\EmailAddress;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * POST auth/apple and auth/google (09 §8.1). The ID token is verified first (IdTokenVerifier). Then:
 * - the subject is linked → sign in (two-factor is skipped for provider sign-ins, 09 §8.1);
 * - not linked, a verified account has the address → AUTH-16: a link code to that address, never an automatic link (ADR-407);
 * - not linked, an unverified account has it → the provider proved the mailbox, so the account is proved (ADR-135) and linked;
 * - no account → a new one (pending_terms), linked.
 * A closed account (deletion pending) answers like a token that fails.
 */
class SignInWithProvider
{
    public function __construct(
        private readonly IdTokenVerifier $verifier,
        private readonly SocialAccounts $social,
        private readonly PasswordlessAccounts $accounts,
        private readonly EmailCodes $codes,
        private readonly AuthMailer $mailer,
        private readonly SignInMember $signIn,
    ) {}

    /**
     * @param  array{id_token: string, raw_nonce?: string|null, authorization_code?: string|null, full_name?: string|null, locale?: string|null}  $input
     */
    public function handle(SocialProvider $provider, array $input, ?DeviceInfo $device, Request $request): PasswordlessResult|LinkRequired|TwoFactorPending
    {
        $identity = $this->verifier->verify($provider, $input['id_token'], $input['raw_nonce'] ?? null);
        $linked = $this->social->find($identity);

        if ($linked !== null) {
            $user = $linked->user;

            if ($user === null || $user->isPendingDeletion() || $user->isDeactivated()) {
                throw new ApiException(ErrorCode::InvalidIdentityToken);
            }

            // SEC-M46-02: a provider never tied to a passed second factor (linked before two-factor was turned on, or from a sign-in that
            // skipped it) asks for the code once; PassTwoFactorChallenge then marks it. Later sign-ins skip it (ADR-429 g).
            if ($user->hasTwoFactor() && $linked->getAttribute('second_factor_at') === null) {
                $pending = $this->signIn->begin($user, $device, $request, ['provider_account' => $linked->id], SignInMethod::forProvider($provider));

                return $pending instanceof TwoFactorPending ? $pending : new PasswordlessResult($pending, false);
            }

            $this->social->touch($linked);

            return new PasswordlessResult($this->signIn->handle($user, $device, $request, method: SignInMethod::forProvider($provider)), false);
        }

        if ($identity->email === null || ! $identity->emailVerified) {
            throw new ApiException(ErrorCode::InvalidIdentityToken);
        }

        $email = EmailAddress::normalize($identity->email);
        $existing = User::withTrashed()->where('email', $email)->first();

        if ($existing !== null && ($existing->isPendingDeletion() || $existing->trashed())) {
            throw new ApiException(ErrorCode::InvalidIdentityToken);
        }

        if ($existing !== null && $existing->hasVerifiedEmail()) {
            return $this->requireLink($existing, $identity, $input);
        }

        [$user, $isNew] = DB::transaction(function () use ($existing, $email, $identity, $input): array {
            if ($existing !== null) {
                $this->accounts->proveMailbox($existing);

                return [$existing, false];
            }

            $name = trim((string) ($input['full_name'] ?? ''));

            return $this->accounts->findOrCreate($email, $input['locale'] ?? null, $identity->provider->value, $name === '' ? null : $name);
        });

        $this->social->link($user, $identity, notify: ! $isNew, authorizationCode: $input['authorization_code'] ?? null);

        return new PasswordlessResult($this->signIn->handle($user, $device, $request, method: SignInMethod::forProvider($provider)), $isNew);
    }

    /**
     * @param  array{id_token: string, raw_nonce?: string|null, authorization_code?: string|null, full_name?: string|null, locale?: string|null}  $input
     */
    private function requireLink(User $user, VerifiedIdentity $identity, array $input): LinkRequired
    {
        $attemptId = Str::random(43);
        $issued = $this->codes->issue($user->email, $attemptId, LoginPurpose::Link, $user->id, payload: [
            'provider' => $identity->provider->value,
            'sub' => $identity->subject,
            'email' => $identity->email,
            'email_verified' => $identity->emailVerified,
            'private_relay' => $identity->privateRelay,
            'audience' => $identity->audience,
            'authorization_code' => $input['authorization_code'] ?? null,
        ]);

        if ($issued !== null) {
            $locale = $user->getAttribute('locale');
            $this->mailer->sendLater($user->email, is_string($locale) ? $locale : app()->getLocale(), new EmailCodeMail(LoginPurpose::Link, $issued->code, provider: $identity->provider));
            Audit::record(MemberSecurityEvent::ProviderLinkRequested->value, $user, after: ['provider' => $identity->provider->value], actor: $user);
        }

        return new LinkRequired($identity->provider, $attemptId, EmailAddress::mask($user->email), $this->codes->resendAfter($user->email, LoginPurpose::Link));
    }
}
