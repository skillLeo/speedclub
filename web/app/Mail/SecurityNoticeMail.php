<?php

namespace App\Mail;

use App\Actions\Security\SecureAccount;
use App\Enums\SecurityNotice;
use App\Services\Privacy\RetentionPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Lang;

class SecurityNoticeMail extends AuthMail
{
    /**
     * @param  string|null  $variant  a more precise intro (`intro_<variant>`), e.g. two-factor "enabled"; unknown variants read the plain intro
     */
    public function __construct(
        public readonly SecurityNotice $notice,
        public readonly ?string $deviceName = null,
        public readonly ?string $variant = null,
        public readonly ?int $count = null,
        // M4.7 (09 §8.4): "Das war ich nicht" (SecureAccountLinks), the approximate place (GeoLite2 only) and the moment, Europe/Berlin.
        public readonly ?string $secureUrl = null,
        public readonly ?string $place = null,
        public readonly ?CarbonImmutable $at = null,
        public readonly ?string $reference = null,
        /** @var array{passkeys: int, providers: int, email_change: bool, two_factor: bool}|null SEC-M47-01: what securing the account removed */
        public readonly ?array $removed = null,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('mail.security.'.$this->notice->value.'.subject');
    }

    protected function heading(): string
    {
        return (string) __('mail.security.'.$this->notice->value.'.heading');
    }

    protected function lines(): array
    {
        $device = $this->deviceName ?? (string) __('mail.security.browser');
        $base = 'mail.security.'.$this->notice->value;
        $intro = $this->variant !== null && Lang::has($base.'.intro_'.$this->variant) ? $base.'.intro_'.$this->variant : $base.'.intro';
        $replace = ['device' => $device, 'days' => app(RetentionPolicy::class)->value('accounts_hard_delete_days'), 'count' => $this->count ?? 0, 'reference' => $this->reference ?? ''];

        $lines = [(string) __($intro, $replace)];

        if (Lang::has($base.'.after')) {
            $lines[] = (string) __($base.'.after', $replace);
        }

        $removed = $this->removed === null ? '' : SecureAccount::removedList($this->removed);

        if ($removed !== '') {
            $lines[] = (string) __('mail.security.removed', ['items' => $removed]);
        }

        if ($this->at !== null) {
            $time = $this->at->setTimezone(config()->string('speedclub.notifications.timezone'))->settings(['locale' => app()->getLocale()])->isoFormat('LLL');
            $lines[] = $this->place === null
                ? (string) __('mail.security.when', ['time' => $time])
                : (string) __('mail.security.when_where', ['time' => $time, 'place' => $this->place]);
        }

        return $lines;
    }

    /**
     * After an e-mail change a reset code would go to the new address, which may be the attacker's, and a closed account has no reset
     * at all: those mails point to support (by e-mail, speedclub.app_config.links.support_email) instead of the reset.
     */
    protected function actions(): array
    {
        if ($this->secureUrl !== null) {
            return [['label' => (string) __('mail.security.secure_action'), 'url' => $this->secureUrl]];
        }

        if ($this->pointsToSupport()) {
            return [['label' => (string) __('mail.security.'.$this->notice->value.'.action'), 'url' => 'mailto:'.$this->support()]];
        }

        return [['label' => (string) __('mail.security.action'), 'url' => $this->url('/app/forgot-password')]];
    }

    protected function note(): string
    {
        if ($this->secureUrl !== null) {
            return (string) __('mail.security.secure_note');
        }

        if ($this->pointsToSupport()) {
            return (string) __('mail.security.'.$this->notice->value.'.note', ['support' => $this->support()]);
        }

        return (string) __('mail.security.note');
    }

    private function pointsToSupport(): bool
    {
        return in_array($this->notice, [SecurityNotice::EmailChanged, SecurityNotice::DeletionRequested, SecurityNotice::AccountSecured], true);
    }

    private function support(): string
    {
        $address = config('speedclub.app_config.links.support_email');

        return is_string($address) && $address !== '' ? $address : 'support@speedclub.de';
    }
}
