<?php

namespace App\Services\Auth;

use App\Actions\Auth\ClearUnprovenAccountData;
use App\Enums\MemberSecurityEvent;
use App\Enums\OnboardingState;
use App\Models\User;
use App\Services\Audit\Audit;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Accounts that start without a password (09 §8.1): an e-mail code, Apple or Google proved the address. They stay pending_terms until
 * AUTH-09b. An existing account nobody had verified gets the same treatment as at a password reset (ADR-135): whatever a stranger set
 * by only typing the address does not bind the real owner, so its password, name, pictures and consents go, and the owner accepts the
 * terms again.
 */
final class PasswordlessAccounts
{
    public function __construct(
        private readonly ClearUnprovenAccountData $unproven,
        private readonly MemberSessions $sessions,
    ) {}

    /**
     * The account of this address, created when there is none. Returns [user, is_new]. Deleted rows (soft deletes) count as taken, so a
     * closed account's address never becomes a fresh account before the hard delete.
     *
     * @return array{0: User, 1: bool}
     */
    public function findOrCreate(string $email, ?string $locale, string $method, ?string $displayName = null): array
    {
        $existing = User::withTrashed()->where('email', $email)->first();

        if ($existing !== null) {
            return [$existing, false];
        }

        try {
            return [$this->create($email, $locale, $method, $displayName), true];
        } catch (UniqueConstraintViolationException) {
            // A parallel request won the race for this address.
            return [User::withTrashed()->where('email', $email)->firstOrFail(), false];
        }
    }

    /**
     * The address of an existing unverified account was just proved by its mailbox (an e-mail code or a provider's verified address).
     */
    public function proveMailbox(User $user): void
    {
        if ($user->hasVerifiedEmail()) {
            return;
        }

        DB::transaction(function () use ($user): void {
            $this->unproven->handle($user);

            $user->forceFill([
                'email_verified_at' => now(),
                'password' => null,
                'remember_token' => Str::random(60),
                'onboarding_state' => OnboardingState::PendingTerms,
                'consented_at' => null,
                'terms_version' => null,
                'privacy_version' => null,
            ])->save();

            $revoked = $this->sessions->revokeAll($user);
            Audit::record(MemberSecurityEvent::EmailVerified->value, $user, after: ['method' => 'passwordless', ...$revoked], actor: $user);
        });
    }

    private function create(string $email, ?string $locale, string $method, ?string $displayName): User
    {
        return DB::transaction(function () use ($email, $locale, $method, $displayName): User {
            $user = new User([
                'email' => $email,
                'locale' => $locale ?? app()->getLocale(),
            ]);
            $user->forceFill([
                'password' => null,
                'email_verified_at' => now(),
                'onboarding_state' => OnboardingState::PendingTerms,
                'display_name' => $displayName === null ? null : Str::limit(trim($displayName), 60, ''),
            ])->save();

            Audit::record(MemberSecurityEvent::Registered->value, $user, after: ['method' => $method, 'passwordless' => true], actor: $user);

            // The column defaults (theme, power display, privacy switches) live in the database: without a refresh the first sign-in
            // answered `member.theme: null` (M4.6 app lane), unlike every later MeResource.
            return $user->refresh();
        });
    }
}
