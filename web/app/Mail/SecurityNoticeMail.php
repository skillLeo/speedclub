<?php

namespace App\Mail;

use App\Enums\SecurityNotice;
use App\Services\Privacy\RetentionPolicy;
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
        $replace = ['device' => $device, 'days' => app(RetentionPolicy::class)->value('accounts_hard_delete_days'), 'count' => $this->count ?? 0];

        $lines = [(string) __($intro, $replace)];

        if (Lang::has($base.'.after')) {
            $lines[] = (string) __($base.'.after', $replace);
        }

        return $lines;
    }

    /**
     * After an e-mail change a reset code would go to the new address, which may be the attacker's, and a closed account has no reset
     * at all: those mails point to support (by e-mail, speedclub.app_config.links.support_email) instead of the reset.
     */
    protected function actions(): array
    {
        if ($this->pointsToSupport()) {
            return [['label' => (string) __('mail.security.'.$this->notice->value.'.action'), 'url' => 'mailto:'.$this->support()]];
        }

        return [['label' => (string) __('mail.security.action'), 'url' => $this->url('/app/forgot-password')]];
    }

    protected function note(): string
    {
        if ($this->pointsToSupport()) {
            return (string) __('mail.security.'.$this->notice->value.'.note', ['support' => $this->support()]);
        }

        return (string) __('mail.security.note');
    }

    private function pointsToSupport(): bool
    {
        return in_array($this->notice, [SecurityNotice::EmailChanged, SecurityNotice::DeletionRequested], true);
    }

    private function support(): string
    {
        $address = config('speedclub.app_config.links.support_email');

        return is_string($address) && $address !== '' ? $address : 'support@speedclub.de';
    }
}
