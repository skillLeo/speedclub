<?php

namespace App\Mail;

use App\Enums\AppealStatus;
use App\Models\Appeal;
use App\Support\Moderation\ModerationText;

/**
 * M3.4 (Art. 20(4) DSA): the outcome of an internal complaint, to whoever appealed (the affected member or a reporter), with the
 * explanation staff wrote and the remaining redress (out-of-court body, court). Rendered in the recipient's locale (SendAppealOutcomeMail).
 */
class AppealDecidedMail extends AuthMail
{
    public function __construct(public readonly Appeal $appeal, public readonly string $explanation) {}

    protected function subjectLine(): string
    {
        return (string) __('moderation.mail.appeal.subject');
    }

    protected function heading(): string
    {
        return (string) __('moderation.mail.appeal.heading');
    }

    protected function lines(): array
    {
        return [
            (string) __('moderation.mail.appeal.intro', ['reference' => $this->appeal->decision_id]),
            (string) __($this->appeal->status === AppealStatus::Upheld ? 'moderation.mail.appeal.upheld' : 'moderation.mail.appeal.reversed'),
            (string) __('moderation.mail.appeal.explanation', ['text' => $this->explanation]),
            (string) __('moderation.mail.appeal.redress', ['url' => ModerationText::disputeSettlementUrl()]),
        ];
    }

    protected function actions(): array
    {
        return [['label' => (string) __('moderation.mail.appeal.action'), 'url' => $this->url('/app/decision/'.$this->appeal->decision_id)]];
    }
}
