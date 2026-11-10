<?php

namespace App\Services\Auth;

use App\Models\User;
use Illuminate\Support\Str;

/**
 * SEC-P2-02: one value per member that changes whenever sign-ins are ended (MemberSessions::revokeAll: password reset, e-mail
 * verification, deletion; DeviceSessions::revoke and revokeOthers: SET-06 and a password change that signs out other devices) and with a
 * new address (ConfirmEmailChange). A signed link that is a credential of its own carries proof() and is checked with matches(), so one
 * rule ends it on every one of those paths. Hidden on the model; no API or export shows it.
 */
final class CredentialEpoch
{
    public static function fresh(): string
    {
        return Str::random(32);
    }

    /**
     * Written at once, also inside a caller's transaction, and kept on the model so a later save() of it does not write the old value.
     */
    public static function rotate(User $user): void
    {
        $epoch = self::fresh();

        User::withTrashed()->whereKey($user->getKey())->toBase()->update(['credentials_epoch' => $epoch]);
        $user->setAttribute('credentials_epoch', $epoch);
        $user->syncOriginalAttribute('credentials_epoch');
    }

    /**
     * A keyed proof of the member's current epoch for one purpose and subject ("export", the export id). 32 hex digits.
     */
    public static function proof(User $user, string $purpose, string $subject): string
    {
        $epoch = $user->getAttribute('credentials_epoch');

        return substr(hash_hmac('sha256', $purpose.'|'.$subject.'|'.(is_string($epoch) ? $epoch : ''), (string) config('app.key')), 0, 32);
    }

    /**
     * Whether $given still proves the current epoch. A link minted before proofs existed carries none: it holds until the first change.
     */
    public static function matches(User $user, string $purpose, string $subject, mixed $given): bool
    {
        if ($given === null) {
            return $user->getAttribute('credentials_epoch') === null;
        }

        return is_string($given) && hash_equals(self::proof($user, $purpose, $subject), $given);
    }
}
