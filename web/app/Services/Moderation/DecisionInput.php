<?php

namespace App\Services\Moderation;

use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Enums\RestrictionType;
use App\Models\Decision;
use App\Models\Staff;
use Carbon\CarbonImmutable;
use InvalidArgumentException;

/**
 * The decision composer's fields (ADM-21): the action, for restrict what it restricts, an end date (null = no end date) for restrict and
 * suspend, and the statement of reasons of Art. 17(3) DSA, with whether automated means found the content (detection) and whether they
 * took the decision (decision; both false today). $decidedBy is the staff member (Phase 3 admin, the operator command); null for the
 * seeder and tests, which audit as the system. A staff suspension needs a second, different staff member ($approvedBy, four-eyes).
 * $reason is the audit reason.
 *
 * M3.2: `reverse` names the decision it lifts ($reverses) and needs the facts (why the measure ends); the ground may stay empty. A
 * moderator suspends for at most 30 days (SuspensionLimit). An own-initiative case (origin staff) is decided the same way.
 */
final readonly class DecisionInput
{
    public function __construct(
        public DecisionAction $action,
        public string $facts,
        public string $ground,
        public GroundDocument $groundDocument,
        public ?string $groundSection = null,
        public bool $automatedDetection = false,
        public bool $automatedDecision = false,
        public ?RestrictionType $restriction = null,
        public ?CarbonImmutable $until = null,
        public ?Staff $decidedBy = null,
        public ?string $reason = null,
        public ?Staff $approvedBy = null,
        public ?Decision $reverses = null,
    ) {
        if (($action === DecisionAction::Reverse) !== ($reverses !== null)) {
            throw new InvalidArgumentException('A reverse decision, and only a reverse decision, names the decision it reverses.');
        }

        if ($action === DecisionAction::Reverse && trim($facts) === '') {
            throw new InvalidArgumentException('A reverse decision tells the member why the measure ends.');
        }

        if ($action === DecisionAction::Suspend && $decidedBy !== null && ! SuspensionLimit::allows($decidedBy, $until)) {
            throw new InvalidArgumentException('A moderator suspends for at most '.SuspensionLimit::MODERATOR_MAX_DAYS.' days.');
        }

        if ($action === DecisionAction::Restrict && $restriction === null) {
            throw new InvalidArgumentException('A restrict decision names what it restricts: messaging or publishing.');
        }

        if ($action !== DecisionAction::Restrict && $restriction !== null) {
            throw new InvalidArgumentException('Only a restrict decision has a restriction type.');
        }

        if (! in_array($action, [DecisionAction::Restrict, DecisionAction::Suspend], true) && $until !== null) {
            throw new InvalidArgumentException('Only restrict and suspend have an end date.');
        }

        if ($until !== null && ! $until->isFuture()) {
            throw new InvalidArgumentException('The end date of a restriction lies in the future.');
        }

        if ($action->restrictsMember() && (trim($facts) === '' || trim($ground) === '')) {
            throw new InvalidArgumentException('A restriction needs facts and a ground (Art. 17(3) DSA).');
        }

        if ($action === DecisionAction::Suspend && $decidedBy !== null
            && ($approvedBy === null || $approvedBy->getKey() === $decidedBy->getKey())) {
            throw new InvalidArgumentException('A suspension by staff needs the approval of a second, different staff member (four-eyes).');
        }
    }
}
