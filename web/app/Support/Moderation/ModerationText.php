<?php

namespace App\Support\Moderation;

use App\Enums\DecisionAction;
use App\Enums\DecisionOutcome;
use App\Enums\DecisionRestriction;
use App\Enums\IllegalSubReason;
use App\Enums\ReportReason;
use App\Enums\ReportTargetType;
use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * The sentences of the moderation mails and WEB-09 in the current locale (lang/{de,en}/moderation.php, safety.php). The app renders its
 * own texts from the API's keys.
 */
final class ModerationText
{
    public static function target(ReportTargetType $type, ?string $label): string
    {
        return $label === null || $label === ''
            ? (string) __('moderation.target_unnamed.'.$type->value)
            : (string) __('moderation.target.'.$type->value, ['label' => $label]);
    }

    public static function outcome(DecisionAction $action, ?DecisionRestriction $restriction, ?CarbonImmutable $until, ?ReportTargetType $target = null): string
    {
        $key = match ($action) {
            DecisionAction::NoAction => 'no_action',
            // A profile loses more than "the content": name, bio, pictures (ContentRemoval).
            DecisionAction::RemoveContent => $target === ReportTargetType::Member ? 'remove_profile' : 'remove_content',
            DecisionAction::Restrict => 'restrict_'.($restriction === DecisionRestriction::Publishing ? 'publishing' : 'messaging'),
            DecisionAction::Suspend => 'suspend',
            DecisionAction::Reverse => 'reverse',
        };

        return $until === null || in_array($key, ['no_action', 'remove_content', 'remove_profile', 'reverse'], true)
            ? (string) __('moderation.outcome.'.$key)
            : (string) __('moderation.outcome.'.$key.'_until', ['date' => self::date($until)]);
    }

    public static function reporterOutcome(DecisionAction $action): string
    {
        return (string) __('moderation.reporter_outcome.'.DecisionOutcome::of($action)->value);
    }

    /**
     * Art. 17(3)(a) DSA: what a restricting decision applies to and how long.
     */
    public static function scope(DecisionAction $action, ?CarbonImmutable $until): ?string
    {
        return match (true) {
            $action === DecisionAction::NoAction, $action === DecisionAction::Reverse => null,
            $action === DecisionAction::RemoveContent => (string) __('moderation.scope.content'),
            $until !== null => (string) __('moderation.scope.account_until', ['date' => self::date($until)]),
            default => (string) __('moderation.scope.account'),
        };
    }

    /**
     * @return list<string> the two Art. 17(3)(c) sentences: how the content was found, and who decided
     */
    public static function automation(bool $detection, bool $decision, bool $ownInitiative = false): array
    {
        $found = match (true) {
            $detection => 'moderation.mail.decision.detection_yes',
            // M3.2: nobody reported it, so "it was reported to us" would be untrue.
            $ownInitiative => 'moderation.mail.decision.detection_own',
            default => 'moderation.mail.decision.detection_no',
        };

        return [
            (string) __($found),
            (string) __($decision ? 'moderation.mail.decision.decision_yes' : 'moderation.mail.decision.decision_no'),
        ];
    }

    public static function disputeSettlementUrl(): string
    {
        return config()->string('speedclub.legal.dispute_settlement_url');
    }

    public static function reason(ReportReason $reason, ?IllegalSubReason $sub = null): string
    {
        $label = (string) __('safety.reasons.'.$reason->value);

        return $sub === null ? $label : $label.' · '.__('safety.sub_reasons.'.$sub->value);
    }

    /**
     * Date only, the same in every locale and in the app's SAFE-01 (M2.8).
     */
    public const DATE_FORMAT = 'd.m.Y';

    /**
     * A calendar day in Berlin ("28.02.2027"): the appeal deadline ends with that day, a restriction with the day it ends.
     */
    public static function date(DateTimeInterface $moment): string
    {
        return CarbonImmutable::instance($moment)->setTimezone(AppealDeadline::TIMEZONE)->format(self::DATE_FORMAT);
    }

    /**
     * A sentence that names the appeal deadline: "<key>" with :date, or "<key>_no_date" with the length of the period when the decision
     * has no notice time yet (Decision::appealUntil() is null), never an empty date.
     *
     * @param  array<string, string>  $replace
     */
    public static function withDeadline(string $key, ?DateTimeInterface $until, array $replace = []): string
    {
        return $until === null
            ? (string) __($key.'_no_date', [...$replace, 'months' => (string) AppealDeadline::MONTHS])
            : (string) __($key, [...$replace, 'date' => self::date($until)]);
    }

    public static function contactAddress(): string
    {
        $address = config('speedclub.moderation.contact_email');
        $support = config('speedclub.app_config.links.support_email');

        return match (true) {
            is_string($address) && $address !== '' => $address,
            is_string($support) && $support !== '' => $support,
            // The mail itself must name an address; the configured From address is the one we know is ours.
            default => config()->string('mail.from.address'),
        };
    }
}
