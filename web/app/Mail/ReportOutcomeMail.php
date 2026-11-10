<?php

namespace App\Mail;

use App\Enums\DecisionAction;
use App\Models\Decision;
use App\Support\Moderation\ModerationText;

/**
 * WEB-09: the decision on a notice, to the address the notifier gave (Art. 16(5) DSA): the outcome only, nothing about the member, and
 * the redress open to a notifier (internal complaint by e-mail within six months, out-of-court settlement, courts).
 */
class ReportOutcomeMail extends AuthMail
{
    public function __construct(
        public readonly Decision $decision,
        public readonly string $reference,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('moderation.mail.outcome.subject');
    }

    protected function heading(): string
    {
        return (string) __('moderation.mail.outcome.heading');
    }

    protected function lines(): array
    {
        $until = $this->decision->appealUntil();

        return [
            (string) __('moderation.mail.outcome.intro', ['reference' => $this->reference]),
            ModerationText::reporterOutcome($this->decision->action),
            ...ModerationText::automation($this->decision->automatedDetection(), $this->decision->automatedDecision()),
            ModerationText::withDeadline('moderation.mail.outcome.redress', $until, [
                'support' => ModerationText::contactAddress(),
                'url' => ModerationText::disputeSettlementUrl(),
            ]),
        ];
    }

    protected function note(): string
    {
        return (string) __($this->decision->action === DecisionAction::NoAction ? 'moderation.mail.outcome.note_no_action' : 'moderation.mail.outcome.note');
    }
}
