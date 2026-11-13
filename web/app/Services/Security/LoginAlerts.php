<?php

namespace App\Services\Security;

use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Models\DeviceInstall;
use App\Models\SecurityEvent;
use App\Models\User;
use App\Services\Notifications\Notifier;
use App\Support\Security\SecurityAlert;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Login alerts of 09 §8.4: a sign-in from an install or browser the account has not used before sends the mandatory security mail
 * (device, time, approximate place when known, "Das war ich nicht"), the HOME-02 row and a push to the account's other devices. At most
 * speedclub.known_devices.max_notices_per_hour per account, so a stolen password cannot flood the owner. Never a secret, a code or an IP.
 * A new way in (passkey, provider) keeps the mails of M4.6, which carry the same link.
 */
final class LoginAlerts
{
    public function __construct(
        private readonly Notifier $notifier,
        private readonly SecureAccountLinks $links,
    ) {}

    public function newDevice(User $user, ?string $deviceName, ?DeviceInstall $install, ?string $installId): void
    {
        $key = 'new-device-notice:'.$user->getKey();

        if (RateLimiter::tooManyAttempts($key, config()->integer('speedclub.known_devices.max_notices_per_hour'))) {
            return;
        }

        RateLimiter::hit($key, 3600);

        $event = $user->securityEvents()->where('type', MemberSecurityEvent::LoginNewDevice)->latest('created_at')->latest('id')->first();

        $this->notifier->security($user, SecurityNotice::NewDevice, $deviceName, alert: new SecurityAlert(
            eventId: $event?->id,
            secureUrl: $event instanceof SecurityEvent ? $this->links->url($user, $event) : null,
            place: $install?->approx_city,
            at: $event?->created_at->toImmutable() ?? now()->toImmutable(),
            pushExceptInstall: $installId,
        ));
    }

    /**
     * The "Das war ich nicht" link for a mail about $type (passkey added, provider linked), or null.
     */
    public function secureUrlFor(User $user, MemberSecurityEvent $type): ?string
    {
        $event = $user->securityEvents()->where('type', $type)->latest('created_at')->latest('id')->first();

        return $event === null ? null : $this->links->url($user, $event);
    }
}
