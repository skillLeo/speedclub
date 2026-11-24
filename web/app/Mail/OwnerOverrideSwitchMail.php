<?php

namespace App\Mail;

/**
 * SEC-P5-03 (ADR-507): an Owner turned the Owner-Override switch of ADM-52 Governance on or off. Every active Owner and Admin gets this
 * mail (StaffAlerts, queued with retries): who, on or off, why and when, with a link to the settings. No payload, no secret.
 */
class OwnerOverrideSwitchMail extends AuthMail
{
    public function __construct(
        public readonly string $actor,
        public readonly bool $enabled,
        public readonly string $reason,
        public readonly string $at,
    ) {}

    private function state(): string
    {
        return (string) __($this->enabled ? 'team.mail.override_switch.on' : 'team.mail.override_switch.off');
    }

    protected function subjectLine(): string
    {
        return (string) __('team.mail.override_switch.subject', ['state' => $this->state()]);
    }

    protected function heading(): string
    {
        return (string) __('team.mail.override_switch.heading', ['name' => $this->actor, 'state' => $this->state()]);
    }

    protected function lines(): array
    {
        return array_values(array_filter([
            (string) __($this->enabled ? 'team.mail.override_switch.intro_on' : 'team.mail.override_switch.intro_off', ['name' => $this->actor]),
            // ADR-540: the reason is optional; no empty "Grund:" line.
            trim($this->reason) === '' ? null : (string) __('team.mail.override_switch.reason', ['reason' => $this->reason]),
            (string) __('team.mail.override_switch.when', ['date' => $this->at]),
        ]));
    }

    protected function actions(): array
    {
        return [['label' => (string) __('team.mail.override_switch.action'), 'url' => $this->url('/admin/settings')]];
    }

    protected function note(): string
    {
        return (string) __('team.mail.override_switch.note');
    }
}
