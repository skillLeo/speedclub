<?php

namespace App\Support\Security;

use App\Models\SocialAccount;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * SET-19 Anmeldung & Passkeys and the SET-01 inline values in one read (09 §7.9).
 */
final readonly class SignInMethodsSummary
{
    /**
     * @param  Collection<int, SocialAccount>  $providers
     * @param  array<string, bool>  $flags  auth.password_login, auth.passkeys, auth.apple, auth.google
     */
    public function __construct(
        public User $user,
        public bool $mailboxReachable,
        public Collection $providers,
        public int $passkeys,
        public array $flags,
    ) {}
}
