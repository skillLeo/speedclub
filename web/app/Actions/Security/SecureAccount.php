<?php

namespace App\Actions\Security;

use App\Actions\Support\CreateSupportTicket;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityActivity;
use App\Enums\SecurityNotice;
use App\Enums\SupportCategory;
use App\Enums\VerificationPurpose;
use App\Models\PasskeyChallenge;
use App\Models\SecurityEvent;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\MemberSessions;
use App\Services\Notifications\Notifier;
use App\Services\Security\SecureAccountLinks;
use App\Support\Security\SecuredAccount;
use App\Support\Security\SecurityAlert;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * "Das war ich nicht" (09 §7.9 SET-21, §8.4): secures the account. Every token, browser session and push token goes, the credential epoch
 * turns (so every link of the account, the alert's own included, stops working), an account with a password must reset it by e-mail
 * code at the next sign-in, and a support request is opened with what was reported. Audited and mailed.
 *
 * SEC-M47-01: whatever a way back in the intruder may have added goes too, since the sign-in the member reported: passkeys and provider
 * links created since then, pending e-mail changes (a code to the intruder's address would hand them the account), and a second factor
 * turned on since then (the intruder's authenticator would lock the owner out). "Since then" is the reported event, or the earliest
 * sign-in from a new device within the alert link's window when that is earlier or nothing was named. Every open "Das war ich nicht"
 * link of the account ends here (SecureAccountLinks). The ticket and the mail list what was removed.
 */
class SecureAccount
{
    public function __construct(
        private readonly MemberSessions $sessions,
        private readonly CreateSupportTicket $tickets,
        private readonly Notifier $notifier,
        private readonly SecureAccountLinks $links,
    ) {}

    /**
     * @param  'app'|'link'  $via  SET-21 in the app, or the link of a mail
     */
    public function handle(User $user, ?SecurityEvent $event, string $via): SecuredAccount
    {
        [$revoked, $reference, $removed] = DB::transaction(function () use ($user, $event, $via): array {
            // SEC-M47-07: a link works once, also when it is used twice at the same moment.
            if ($via === 'link' && $event !== null) {
                $this->links->claim($event);
            }

            $removed = $this->removeWaysIn($user, $this->since($user, $event));
            $reference = CreateSupportTicket::reference($this->tickets->forMember($user, SupportCategory::Account, $this->subject($user), $this->message($user, $event, $removed)));
            $revoked = $this->sessions->revokeAll($user);
            $this->links->closeAll($user);

            if ($user->hasPassword()) {
                // The next sign-in asks for a new password with an e-mail code (DemandPasswordChange): a known password is not enough.
                $user->forceFill(['force_password_change' => true])->save();
            }

            Audit::record(MemberSecurityEvent::AccountSecured->value, $user, after: [
                ...$revoked,
                'via' => $via,
                'reported' => $event?->activity()?->value,
                'reported_event_id' => $event?->id,
                'reference' => $reference,
                'passkeys' => $removed['passkeys'],
                'providers' => $removed['providers'],
                'email_change_cancelled' => $removed['email_change'],
                'two_factor_reset' => $removed['two_factor'],
            ], actor: $user);

            return [$revoked, $reference, $removed];
        });

        $this->notifier->security($user, SecurityNotice::AccountSecured, alert: new SecurityAlert(reference: $reference, removed: $removed));

        return new SecuredAccount($reference, $revoked['devices'], $revoked['sessions'], $user->hasPassword(), $removed);
    }

    /**
     * The moment from which additions count as the intruder's, or null when nothing points to one (no event named, no new-device sign-in
     * within the link window): then only sessions and the password are dealt with, and support reviews the rest.
     */
    private function since(User $user, ?SecurityEvent $event): ?CarbonImmutable
    {
        $earliestNewDevice = $user->securityEvents()
            ->where('type', MemberSecurityEvent::LoginNewDevice)
            ->where('created_at', '>=', now()->subDays(config()->integer('speedclub.security_events.secure_link_days')))
            ->min('created_at');

        $moments = array_filter([
            $event?->created_at->toImmutable(),
            is_string($earliestNewDevice) ? CarbonImmutable::parse($earliestNewDevice) : null,
        ]);

        return $moments === [] ? null : min($moments);
    }

    /**
     * @return array{passkeys: int, providers: int, email_change: bool, two_factor: bool}
     */
    private function removeWaysIn(User $user, ?CarbonImmutable $since): array
    {
        // A pending e-mail change is always cancelled: its code goes to an address the owner may not know.
        $emailChange = $user->verificationCodes()->where('purpose', VerificationPurpose::EmailChange)->delete() > 0;

        if ($since === null) {
            return ['passkeys' => 0, 'providers' => 0, 'email_change' => $emailChange, 'two_factor' => false];
        }

        $passkeys = $user->memberPasskeys()->where('created_at', '>=', $since)->delete();
        PasskeyChallenge::query()->where('user_id', $user->id)->delete();
        $providers = $user->socialAccounts()->where('created_at', '>=', $since)->delete();

        $confirmed = $user->getAttribute('two_factor_confirmed_at');
        $twoFactor = $user->hasTwoFactor() && ($confirmed === null || CarbonImmutable::parse($confirmed)->greaterThanOrEqualTo($since));

        if ($twoFactor) {
            // Turned off rather than enforced: the authenticator may be the intruder's. Support reviews it with the owner (ticket).
            $user->forceFill([
                'two_factor_secret' => null,
                'two_factor_confirmed_at' => null,
                'two_factor_recovery_codes' => null,
                'two_factor_last_step' => null,
            ])->save();
        }

        return ['passkeys' => $passkeys, 'providers' => $providers, 'email_change' => $emailChange, 'two_factor' => $twoFactor];
    }

    private function subject(User $user): string
    {
        return (string) __('settings.security.ticket_subject', [], $this->locale($user));
    }

    /**
     * @param  array{passkeys: int, providers: int, email_change: bool, two_factor: bool}  $removed
     */
    private function message(User $user, ?SecurityEvent $event, array $removed): string
    {
        $locale = $this->locale($user);
        $activity = $event?->activity();
        $list = self::removedList($removed, $locale);
        $suffix = $list === '' ? '' : ' '.__('settings.security.ticket_removed', ['items' => $list], $locale);

        if ($event === null || ! $activity instanceof SecurityActivity) {
            return __('settings.security.ticket_message_plain', [], $locale).$suffix;
        }

        return __('settings.security.ticket_message', [
            'event' => __('settings.security.activity.'.$activity->value, [], $locale),
            'time' => $event->created_at->toImmutable()->setTimezone(config()->string('speedclub.notifications.timezone'))->settings(['locale' => $locale])->isoFormat('LLL'),
            'device' => $event->device_name ?? __('settings.security.unknown_device', [], $locale),
        ], $locale).$suffix;
    }

    /**
     * "1 Passkey, 1 verbundenes Konto, die offene E-Mail-Änderung, den Zwei-Faktor-Schutz", or '' when nothing was removed. Also used by
     * the mail (SecurityNoticeMail).
     *
     * @param  array{passkeys: int, providers: int, email_change: bool, two_factor: bool}  $removed
     */
    public static function removedList(array $removed, ?string $locale = null): string
    {
        $items = [];

        if ($removed['passkeys'] > 0) {
            $items[] = trans_choice('settings.security.removed.passkeys', $removed['passkeys'], ['count' => $removed['passkeys']], $locale);
        }

        if ($removed['providers'] > 0) {
            $items[] = trans_choice('settings.security.removed.providers', $removed['providers'], ['count' => $removed['providers']], $locale);
        }

        if ($removed['email_change']) {
            $items[] = (string) __('settings.security.removed.email_change', [], $locale);
        }

        if ($removed['two_factor']) {
            $items[] = (string) __('settings.security.removed.two_factor', [], $locale);
        }

        return implode(', ', $items);
    }

    private function locale(User $user): string
    {
        $locale = $user->getAttribute('locale');

        return is_string($locale) && in_array($locale, config()->array('speedclub.locales'), true) ? $locale : 'de';
    }
}
