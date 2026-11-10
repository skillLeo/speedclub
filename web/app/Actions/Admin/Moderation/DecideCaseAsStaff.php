<?php

namespace App\Actions\Admin\Moderation;

use App\Actions\Moderation\DecideCase;
use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Models\ApprovalRequest;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Moderation\CaseRecord;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\Statement;
use App\Services\Moderation\SuspensionLimit;
use App\Support\Moderation\ModerationText;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The ADM-21/22 decision composer (m3.4-contract §1): fills DecisionInput for DecideCase, the only writer of decisions, with this staff
 * member as decider. `automated_detection` is the case's (a keyword rule or the [AI] triage found it), `automated_decision` is always
 * false: a person decides. A message case also needs moderation.messages. A suspension never executes here: it asks for the
 * `moderation.suspend` approval with the case as subject (members.suspend; moderators at most 30 days), and the approver's
 * execution decides it. no_action needs no statement: the affected member is never told, the reporters hear the outcome only.
 *
 * @throws AuthorizationException|DomainException|ValidationException
 */
class DecideCaseAsStaff
{
    public const NO_ACTION_FACTS = 'Geprüft: kein Verstoß gegen die Community-Richtlinien, die AGB oder das Gesetz festgestellt.';

    public function __construct(
        private readonly DecideCase $decide,
        private readonly Approvals $approvals,
    ) {}

    public function handle(Staff $staff, ModerationCase $case, DecisionAction $action, ?RestrictionType $restriction, ?CarbonImmutable $until, ?Statement $statement, string $reason): Decision|ApprovalRequest
    {
        StaffAtoms::ensure($staff, 'moderation.decide');

        if ($case->target_type === ReportTargetType::Message) {
            StaffAtoms::ensure($staff, 'moderation.messages');
        }

        if (! $case->status->isOpen()) {
            throw new DomainException('The case is not open.');
        }

        if ($action === DecisionAction::Reverse) {
            throw ValidationException::withMessages(['action' => [(string) __('validation.in', ['attribute' => 'action'])]]);
        }

        if ($action->restrictsMember() && $statement === null) {
            throw ValidationException::withMessages(['facts' => [(string) __('validation.required', ['attribute' => 'facts'])]]);
        }

        if ($action === DecisionAction::Suspend) {
            return $this->requestSuspension($staff, $case, $until, $statement, $reason);
        }

        return DB::transaction(fn (): Decision => $this->decide->handle($case, new DecisionInput(
            action: $action,
            facts: $statement->facts ?? self::NO_ACTION_FACTS,
            ground: $statement->ground ?? '',
            groundDocument: $statement->groundDocument ?? GroundDocument::Community,
            groundSection: $statement?->groundSection,
            automatedDetection: CaseRecord::automatedDetection($case),
            automatedDecision: false,
            restriction: $action === DecisionAction::Restrict ? $restriction : null,
            until: in_array($action, [DecisionAction::Restrict, DecisionAction::Suspend], true) ? $until : null,
            decidedBy: $staff,
            reason: trim($reason),
        )));
    }

    private function requestSuspension(Staff $staff, ModerationCase $case, ?CarbonImmutable $until, ?Statement $statement, string $reason): ApprovalRequest
    {
        StaffAtoms::ensure($staff, 'members.suspend');

        if ($case->subject_id === null || $statement === null) {
            throw new DomainException('There is no account to suspend.');
        }

        if (! SuspensionLimit::allows($staff, $until)) {
            throw ValidationException::withMessages(['until' => [(string) __('moderation.suspension_limit', [
                'days' => SuspensionLimit::MODERATOR_MAX_DAYS,
                'date' => ModerationText::date(SuspensionLimit::latestEnd()),
            ])]]);
        }

        return $this->approvals->request('moderation.suspend', [
            'case_id' => $case->id,
            ...$statement->toArray(),
            'until' => $until?->toIso8601String(),
            'automated_detection' => CaseRecord::automatedDetection($case),
            'automated_decision' => false,
        ], $reason, $staff, $case);
    }
}
