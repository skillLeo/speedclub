<?php

namespace App\Mail;

/**
 * ADR-507: an Owner executed their own four-eyes request (a publishing change) because no second eligible approver existed. Every active
 * Owner and Admin and everyone who approved a request in the last 90 days gets this mail, the actor included (SEC-P5-01 c, queued with
 * retries through StaffAlerts): who, what, why (the reason) and when, with a link to the audit log. No payload, no secret.
 */
class OwnerOverrideMail extends AuthMail
{
    public function __construct(
        public readonly string $actor,
        public readonly string $action,
        public readonly string $reason,
        public readonly string $at,
    ) {}

    private function actionLabel(): string
    {
        $key = "team.mail.owner_override.actions.$this->action";
        $label = (string) __($key);

        return $label === $key ? $this->action : $label;
    }

    protected function subjectLine(): string
    {
        return (string) __('team.mail.owner_override.subject', ['action' => $this->actionLabel()]);
    }

    protected function heading(): string
    {
        return (string) __('team.mail.owner_override.heading', ['name' => $this->actor]);
    }

    protected function lines(): array
    {
        return array_values(array_filter([
            (string) __('team.mail.owner_override.intro', ['name' => $this->actor, 'action' => $this->actionLabel()]),
            // ADR-540: the reason is optional; no empty "Grund:" line.
            trim($this->reason) === '' ? null : (string) __('team.mail.owner_override.reason', ['reason' => $this->reason]),
            (string) __('team.mail.owner_override.when', ['date' => $this->at]),
        ]));
    }

    protected function actions(): array
    {
        return [['label' => (string) __('team.mail.owner_override.action'), 'url' => $this->url('/admin/audit?filter%5Baction%5D=approval.owner_override')]];
    }

    protected function note(): string
    {
        return (string) __('team.mail.owner_override.note');
    }
}
