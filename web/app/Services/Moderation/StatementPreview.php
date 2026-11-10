<?php

namespace App\Services\Moderation;

use App\Enums\DecisionAction;
use App\Enums\DecisionRestriction;
use App\Enums\RedressOption;
use App\Enums\ReportTargetType;
use App\Support\Moderation\AppealDeadline;
use App\Support\Moderation\ModerationText;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\App;

/**
 * What the member will read (SAFE-01 and the decision mail, Art. 17 DSA) for a decision the composer is about to send, in German and
 * English (m3.4-contract §2 ADM-21 "preview of the member's SAFE-01 text DE/EN"). The same sentences as ModerationDecisionMail, with the
 * appeal deadline counted from now. Nothing is stored.
 */
final class StatementPreview
{
    /**
     * @return array{de: list<string>, en: list<string>}
     */
    public static function render(
        DecisionAction $action,
        ?DecisionRestriction $restriction,
        ?CarbonImmutable $until,
        string $facts,
        string $ground,
        bool $automatedDetection,
        bool $ownInitiative,
        ReportTargetType $targetType,
        ?string $targetLabel,
        ?CarbonImmutable $now = null,
    ): array {
        $previous = App::getLocale();
        // The appeal deadline counts from the moment of the preview; the visual matrix freezes it with ?qaNow= (QaClock, DQ-700).
        $deadline = AppealDeadline::from($now ?? CarbonImmutable::now());
        $lines = [];

        try {
            foreach (['de', 'en'] as $locale) {
                App::setLocale($locale);
                $lines[$locale] = self::lines($action, $restriction, $until, $facts, $ground, $automatedDetection, $ownInitiative, $targetType, $targetLabel, $deadline);
            }
        } finally {
            App::setLocale($previous);
        }

        return ['de' => $lines['de'], 'en' => $lines['en']];
    }

    /**
     * @return list<string>
     */
    private static function lines(DecisionAction $action, ?DecisionRestriction $restriction, ?CarbonImmutable $until, string $facts, string $ground, bool $automatedDetection, bool $ownInitiative, ReportTargetType $targetType, ?string $targetLabel, CarbonImmutable $deadline): array
    {
        if ($action === DecisionAction::NoAction) {
            // The affected member is not told of a no_action decision; the reporters read the outcome only.
            return [ModerationText::reporterOutcome($action)];
        }

        $lines = [
            (string) __($ownInitiative ? 'moderation.mail.decision.intro_own' : 'moderation.mail.decision.intro', ['target' => ModerationText::target($targetType, $targetLabel)]),
            ModerationText::outcome($action, $restriction, $until, $targetType),
        ];
        $scope = ModerationText::scope($action, $until);

        if ($scope !== null) {
            $lines[] = $scope;
        }

        $lines[] = (string) __('moderation.mail.decision.facts', ['facts' => trim($facts)]);
        $lines[] = (string) __('moderation.mail.decision.ground', ['ground' => trim($ground)]);
        array_push($lines, ...ModerationText::automation($automatedDetection, false, $ownInitiative));

        foreach (RedressOption::cases() as $option) {
            $lines[] = match ($option) {
                RedressOption::InternalComplaint => ModerationText::withDeadline('moderation.mail.decision.redress.internal_complaint', $deadline),
                RedressOption::OutOfCourt => (string) __('moderation.mail.decision.redress.out_of_court', ['url' => ModerationText::disputeSettlementUrl()]),
                RedressOption::Court => (string) __('moderation.mail.decision.redress.court'),
            };
        }

        return $lines;
    }
}
