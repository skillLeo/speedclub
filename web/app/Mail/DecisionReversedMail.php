<?php

namespace App\Mail;

use App\Enums\DecisionAction;
use App\Enums\DecisionRestriction;
use App\Enums\ReportTargetType;
use App\Models\Decision;
use App\Support\Moderation\ModerationText;

/**
 * M3.2 (m3.2-contract §1): a `reverse` decision lifted an earlier measure (staff lifted a restriction or unhid content, or an appeal
 * succeeded). Tells the member what is back and why, in their language while sending; no redress, nothing is held against them. The
 * facts are the decider's own words.
 */
class DecisionReversedMail extends AuthMail
{
    public function __construct(
        public readonly Decision $decision,
        public readonly ReportTargetType $targetType,
        public readonly ?string $targetLabel,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __('moderation.mail.reversed.subject');
    }

    protected function heading(): string
    {
        return (string) __('moderation.mail.reversed.heading');
    }

    protected function lines(): array
    {
        $original = $this->decision->reverses;
        $lines = [];

        if ($original instanceof Decision) {
            $lines[] = (string) __('moderation.mail.reversed.intro', [
                'date' => ModerationText::date($original->decided_at),
                'target' => ModerationText::target($this->targetType, $this->targetLabel),
            ]);
            $lines[] = (string) __('moderation.mail.reversed.lifted.'.$this->liftedKey($original));
        }

        $lines[] = (string) __('moderation.mail.reversed.facts', ['facts' => $this->decision->facts()]);

        return $lines;
    }

    protected function actions(): array
    {
        return [['label' => (string) __('moderation.mail.reversed.action'), 'url' => $this->url('/app/decision/'.$this->decision->id)]];
    }

    protected function note(): string
    {
        return (string) __('moderation.mail.reversed.note', ['support' => ModerationText::contactAddress(), 'reference' => $this->decision->id]);
    }

    private function liftedKey(Decision $original): string
    {
        return match ($original->action) {
            DecisionAction::RemoveContent => $this->targetType === ReportTargetType::Member ? 'remove_profile' : 'remove_content',
            DecisionAction::Restrict => $original->restrictionType() === DecisionRestriction::Publishing ? 'restrict_publishing' : 'restrict_messaging',
            default => 'suspend',
        };
    }
}
