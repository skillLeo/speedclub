<?php

namespace App\Mail;

use App\Enums\DecisionAction;
use App\Enums\DecisionRestriction;
use App\Enums\RedressOption;
use App\Enums\ReportTargetType;
use App\Models\Decision;
use App\Support\Moderation\ModerationText;

/**
 * The mandatory statement of reasons (Art. 17 DSA, 02_PRODUCT_SPEC §7) to the affected member: what was decided and about what, the
 * scope and duration, the facts, the ground, whether automated means found the content or decided, and the redress: the internal appeal with its deadline (in the app, or by
 * e-mail for a member who cannot sign in), a certified out-of-court dispute settlement body and the courts. Read in the member's
 * locale while sending; facts and ground are the decider's own words.
 */
class ModerationDecisionMail extends AuthMail
{
    public function __construct(
        public readonly Decision $decision,
        public readonly ReportTargetType $targetType,
        public readonly ?string $targetLabel,
        // M3.2: staff decided without a report (an own-initiative case).
        public readonly bool $ownInitiative = false,
    ) {}

    protected function subjectLine(): string
    {
        return (string) __($this->ownInitiative ? 'moderation.mail.decision.subject_own' : 'moderation.mail.decision.subject');
    }

    protected function heading(): string
    {
        return (string) __('moderation.mail.decision.heading');
    }

    protected function lines(): array
    {
        $decision = $this->decision;
        $until = $decision->appealUntil();
        $lines = [
            (string) __($this->ownInitiative ? 'moderation.mail.decision.intro_own' : 'moderation.mail.decision.intro', ['target' => ModerationText::target($this->targetType, $this->targetLabel)]),
            ModerationText::outcome($decision->action, $decision->restrictionType(), $decision->restrictionUntil(), $this->targetType),
        ];
        $scope = ModerationText::scope($decision->action, $decision->restrictionUntil());

        if ($scope !== null) {
            $lines[] = $scope;
        }

        $lines = [
            ...$lines,
            (string) __('moderation.mail.decision.facts', ['facts' => $decision->facts()]),
            (string) __('moderation.mail.decision.ground', ['ground' => $decision->ground()]),
            ...ModerationText::automation($decision->automatedDetection(), $decision->automatedDecision(), $this->ownInitiative),
        ];

        foreach ($decision->redress() as $option) {
            $lines[] = match ($option) {
                RedressOption::InternalComplaint => ModerationText::withDeadline('moderation.mail.decision.redress.internal_complaint', $until),
                RedressOption::OutOfCourt => (string) __('moderation.mail.decision.redress.out_of_court', ['url' => ModerationText::disputeSettlementUrl()]),
                RedressOption::Court => (string) __('moderation.mail.decision.redress.court'),
            };
        }

        return $lines;
    }

    protected function actions(): array
    {
        return [['label' => (string) __('moderation.mail.decision.action'), 'url' => $this->url('/app/decision/'.$this->decision->id)]];
    }

    /**
     * A suspended member cannot sign in (SignInMember), so the appeal also works by e-mail.
     */
    protected function note(): string
    {
        $until = $this->decision->appealUntil();
        $suspended = $this->decision->action === DecisionAction::Suspend || $this->decision->restrictionType() === DecisionRestriction::Suspension;

        return ModerationText::withDeadline($suspended ? 'moderation.mail.decision.note_suspended' : 'moderation.mail.decision.note', $until, [
            'support' => ModerationText::contactAddress(),
            'reference' => $this->decision->id,
        ]);
    }
}
