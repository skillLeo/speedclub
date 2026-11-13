<?php

namespace App\Services\Auth\IdTokens;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Models\SocialAccount;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Notifications\Notifier;
use App\Services\Security\LoginAlerts;
use App\Support\Security\SecurityAlert;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Linking a verified provider identity to an account (09 §8.1): one row per provider subject, never two accounts for one subject. Every
 * link writes the audit event; a link to an existing account also sends the security mail and the in-app row (an account created by
 * the provider sign-in itself gets none: that is its first way in, not a change).
 */
final class SocialAccounts
{
    public function __construct(
        private readonly Notifier $notifier,
        private readonly AppleTokens $apple,
    ) {}

    public function find(VerifiedIdentity $identity): ?SocialAccount
    {
        return SocialAccount::query()->where('provider', $identity->provider)->where('provider_sub', $identity->subject)->first();
    }

    public function link(User $user, VerifiedIdentity $identity, bool $notify, ?string $authorizationCode = null): SocialAccount
    {
        $existing = $this->find($identity);

        if ($existing !== null) {
            if ($existing->user_id !== $user->id) {
                throw new ApiException(ErrorCode::ProviderAlreadyLinked);
            }

            return $existing;
        }

        $refresh = $this->apple->exchange($authorizationCode, $identity->audience);

        try {
            $account = DB::transaction(function () use ($user, $identity, $refresh): SocialAccount {
                $account = new SocialAccount;
                $account->forceFill([
                    'user_id' => $user->id,
                    'provider' => $identity->provider,
                    'provider_sub' => $identity->subject,
                    'email' => $identity->email,
                    'email_verified' => $identity->emailVerified,
                    'is_private_relay' => $identity->privateRelay,
                    'refresh_token_encrypted' => $refresh,
                    'last_used_at' => now(),
                ])->save();

                Audit::record(MemberSecurityEvent::ProviderLinked->value, $user, after: [
                    'provider' => $identity->provider->value,
                    'private_relay' => $identity->privateRelay,
                    'refresh_token' => $refresh !== null,
                ], actor: $user);

                return $account;
            });
        } catch (UniqueConstraintViolationException) {
            throw new ApiException(ErrorCode::ProviderAlreadyLinked);
        }

        if ($notify) {
            // M4.7 (09 §8.4): a new way in is a login alert too, with "Das war ich nicht".
            $this->notifier->security($user, SecurityNotice::ProviderLinked, $identity->provider->label((string) $user->getAttribute('locale')), alert: new SecurityAlert(
                secureUrl: app(LoginAlerts::class)->secureUrlFor($user, MemberSecurityEvent::ProviderLinked),
            ));
        }

        return $account;
    }

    public function touch(SocialAccount $account): void
    {
        $account->forceFill(['last_used_at' => now()])->save();
    }

    /**
     * Apple's refresh token is revoked first (09 §8.1: the outcome is logged, a 200 is no proof), then the row goes.
     */
    public function unlink(User $user, SocialAccount $account, bool $notify = true): void
    {
        $revoke = $account->provider->value === 'apple' ? $this->apple->revoke($account) : null;

        DB::transaction(function () use ($user, $account, $revoke): void {
            $account->delete();

            Audit::record(MemberSecurityEvent::ProviderUnlinked->value, $user, after: [
                'provider' => $account->provider->value,
                'apple_revoke' => $revoke,
            ], actor: $user);
        });

        if ($notify) {
            $this->notifier->security($user, SecurityNotice::ProviderUnlinked, $account->provider->label((string) $user->getAttribute('locale')));
        }
    }
}
