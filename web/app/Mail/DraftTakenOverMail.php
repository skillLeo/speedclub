<?php

namespace App\Mail;

/**
 * SEC-P5-07 (M5.1): another staff member took over the recipient's config draft ("Entwurf übernehmen", with a reason). The former author
 * learns who, which area, why and when (StaffAlerts, queued with retries). No payload of the draft, no secret.
 */
class DraftTakenOverMail extends AuthMail
{
    public function __construct(
        public readonly string $actor,
        public readonly string $key,
        public readonly string $reason,
        public readonly string $at,
    ) {}

    private function area(): string
    {
        $line = "team.mail.draft_taken_over.keys.$this->key";
        $label = (string) __($line);

        return $label === $line ? $this->key : $label;
    }

    protected function subjectLine(): string
    {
        return (string) __('team.mail.draft_taken_over.subject', ['area' => $this->area()]);
    }

    protected function heading(): string
    {
        return (string) __('team.mail.draft_taken_over.heading', ['name' => $this->actor]);
    }

    protected function lines(): array
    {
        return [
            (string) __('team.mail.draft_taken_over.intro', ['name' => $this->actor, 'area' => $this->area()]),
            (string) __('team.mail.draft_taken_over.reason', ['reason' => $this->reason]),
            (string) __('team.mail.draft_taken_over.when', ['date' => $this->at]),
        ];
    }

    protected function actions(): array
    {
        return [['label' => (string) __('team.mail.draft_taken_over.action'), 'url' => $this->url('/admin/audit?filter%5Baction%5D=config.draft_taken_over')]];
    }

    protected function note(): string
    {
        return (string) __('team.mail.draft_taken_over.note');
    }
}
