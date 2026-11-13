<?php

namespace App\Services\Security;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\SecurityEvent;
use App\Models\User;
use App\Services\Auth\CredentialEpoch;
use Illuminate\Support\Carbon;

/**
 * "Das war ich nicht" in a security mail (09 §8.4): /auth/secure#t=<event id>.<proof>, the token in the fragment only (ADR-138). The proof
 * is keyed with the app key to the event and the member. Valid for speedclub.security_events.secure_link_days after the event, and once:
 * securing the account marks every open event of the account (secured_at, taken under a row lock, so two clicks at once secure once).
 *
 * SEC-M47-05: the proof no longer follows the credential epoch, which a signed-in intruder turns with "Alle anderen abmelden" or a
 * password change, and would void the owner's link that way. Only securing the account and deleting it end a link. A link minted with
 * the epoch proof before this change still works while that epoch holds.
 */
final class SecureAccountLinks
{
    private const PURPOSE = 'secure-account';

    public function token(User $user, SecurityEvent $event): string
    {
        return $event->id.'.'.$this->proof($user, $event->id);
    }

    public function url(User $user, SecurityEvent $event): string
    {
        return rtrim(config()->string('app.url'), '/').'/auth/secure#t='.$this->token($user, $event);
    }

    /**
     * The event the token names, when the proof holds, the link has not expired and it was not used (or ended by securing) yet. The event
     * id is not secret; the proof is checked in constant time. SecureAccount checks secured_at again under the row lock.
     */
    public function resolve(string $token): ?SecurityEvent
    {
        [$id, $proof] = array_pad(explode('.', $token, 2), 2, '');

        if (preg_match('/\A[0-9A-HJKMNP-TV-Z]{26}\z/i', $id) !== 1) {
            return null;
        }

        $event = SecurityEvent::query()->with('user')->find(strtolower($id));
        $user = $event?->user;

        if ($event === null || ! $user instanceof User || $event->getAttribute('secured_at') !== null || $event->created_at->lt($this->windowStart())) {
            return null;
        }

        $valid = hash_equals($this->proof($user, $event->id), $proof) || CredentialEpoch::matches($user, self::PURPOSE, $event->id, $proof === '' ? '-' : $proof);

        return $valid ? $event : null;
    }

    /**
     * Ends every open link of the account: called by SecureAccount inside its transaction.
     */
    public function closeAll(User $user): void
    {
        SecurityEvent::query()
            ->where('user_id', $user->getKey())
            ->whereNull('secured_at')
            ->where('created_at', '>=', $this->windowStart())
            ->update(['secured_at' => now()]);
    }

    /**
     * Claims $event for one use, under its row lock; a second use (also one that waited for the lock) is the 422 of an invalid link.
     */
    public function claim(SecurityEvent $event): void
    {
        $locked = SecurityEvent::query()->whereKey($event->getKey())->lockForUpdate()->first();

        if ($locked === null || $locked->getAttribute('secured_at') !== null) {
            throw self::invalid();
        }
    }

    public static function invalid(): ApiException
    {
        return new ApiException(ErrorCode::ValidationFailed, errors: ['token' => [(string) __('settings.security.secure_link_invalid')]]);
    }

    private function proof(User $user, string $eventId): string
    {
        return substr(hash_hmac('sha256', self::PURPOSE.'|'.$eventId.'|'.$user->getKey(), config()->string('app.key')), 0, 32);
    }

    private function windowStart(): Carbon
    {
        return now()->subDays(config()->integer('speedclub.security_events.secure_link_days'));
    }
}
