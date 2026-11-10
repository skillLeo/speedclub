<?php

namespace App\Actions\Admin\Moderation;

use App\Actions\Moderation\DecideCase;
use App\Actions\Moderation\ReverseDecision;
use App\Enums\AppealStatus;
use App\Enums\DecisionAction;
use App\Enums\DecisionViewer;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Models\Appeal;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Moderation\CaseTargets;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\OwnInitiativeCases;
use App\Services\Moderation\SendAppealOutcomeMail;
use App\Services\Moderation\Statement;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * An internal complaint decided (Art. 20 DSA, m3.4-contract §1; `moderation.appeals`, recent password, reason): **by a different staff
 * member than the ones who took the decision** (refused here, whatever the page shows): neither its decider nor, for a suspension, the
 * second staff member who approved it (SF-4 of the M3.4-batch review). An appeal against a decision on a **message** also needs
 * `moderation.messages`, the atom that opens the evidence it must be weighed on (SF-5). The explanation is what the appellant reads.
 *
 * - upheld: the decision stands; the appellant is told in the app (the decision's SAFE-01 now shows the outcome) and by e-mail.
 * - reversed, appeal of the affected member: a `reverse` decision (ReverseDecision, DecideCase) lifts the restriction or restores the
 *   content; its case names the appeal, so the member, the appellant and the original reporters are told.
 * - reversed, appeal of a reporter (typically against no action): the measure staff now take on the target (remove content or
 *   restrict; a suspension goes through the member record and its approval) is decided on the target's case, which names the appeal.
 *
 * Audited `moderation.appeal_decided` (no complaint text).
 *
 * @throws AuthorizationException|DomainException|ValidationException
 */
class DecideAppeal
{
    public function __construct(
        private readonly ReverseDecision $reverse,
        private readonly DecideCase $decide,
        private readonly OwnInitiativeCases $cases,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @param  array{action: DecisionAction, restriction: ?RestrictionType, until: ?CarbonImmutable, statement: Statement}|null  $measure  for an overturned reporter appeal
     */
    public function handle(Staff $staff, Appeal $appeal, AppealStatus $outcome, string $explanation, string $reason, ?array $measure = null): Appeal
    {
        StaffAtoms::ensure($staff, 'moderation.appeals');

        if ($outcome === AppealStatus::Open) {
            throw ValidationException::withMessages(['outcome' => [(string) __('validation.in', ['attribute' => 'outcome'])]]);
        }

        $result = DB::transaction(function () use ($staff, $appeal, $outcome, $explanation, $reason, $measure): array {
            $locked = Appeal::query()->whereKey($appeal->id)->lockForUpdate()->firstOrFail();
            $decision = Decision::query()->whereKey($locked->decision_id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== AppealStatus::Open) {
                throw new DomainException('The appeal is decided already.');
            }

            // SF-5: the evidence of a message case is behind moderation.messages (CaseEvidence); nobody decides on it blind.
            if (ModerationCase::query()->whereKey($decision->case_id)->where('target_type', ReportTargetType::Message)->exists()) {
                StaffAtoms::ensure($staff, 'moderation.messages');
            }

            // Art. 20(6) DSA: not a person who took the decision under appeal.
            if ($this->tookPart($staff, $decision)) {
                throw new AuthorizationException('appeal_same_staff');
            }

            $new = $outcome === AppealStatus::Reversed ? $this->overturn($staff, $locked, $decision, $explanation, $reason, $measure) : null;

            $locked->forceFill(['status' => $outcome, 'outcome_explanation' => trim($explanation), 'decided_by' => $staff->id, 'decided_at' => now()])->save();

            Audit::record('moderation.appeal_decided', $locked, ['status' => AppealStatus::Open->value], [
                'appeal_id' => $locked->id,
                'decision_id' => $decision->id,
                'role' => $locked->role->value,
                'outcome' => $outcome->value,
                'new_decision_id' => $new?->id,
                'original_decided_by' => $decision->decided_by,
            ], trim($reason), $staff);

            return [$locked, $decision];
        });

        [$decided, $decision] = $result;

        DB::afterCommit(function () use ($decided, $decision, $outcome): void {
            $appellant = $decided->appellant_id === null ? null : User::query()->find($decided->appellant_id);

            if (! $appellant instanceof User) {
                return;
            }

            // An overturned appeal's new decision told them already (DecideCase); an upheld one points at the decision that stands.
            if ($outcome === AppealStatus::Upheld) {
                $decided->role === DecisionViewer::Affected
                    ? $this->notifier->moderationDecision($appellant, $decision)
                    : $this->notifier->reportDecided($appellant, $decision);
            }

            SendAppealOutcomeMail::dispatch($decided->id);
        });

        return $decided;
    }

    /**
     * The decider, or the second pair of eyes of a suspension (SF-4): the approver of the `moderation.suspend` request that produced it,
     * or the `--approved-by` of the operator command. Both write `approved_by` into the decision's `moderation.decided` audit event;
     * the approval row is read too, so an archived audit range does not hide it.
     */
    private function tookPart(Staff $staff, Decision $decision): bool
    {
        if ($decision->decided_by !== null && $decision->decided_by === $staff->id) {
            return true;
        }

        if ($decision->action !== DecisionAction::Suspend) {
            return false;
        }

        $approved = ApprovalRequest::query()
            ->where('action', 'moderation.suspend')
            ->where('decided_by', $staff->id)
            ->where('result->decision_id', $decision->id)
            ->exists();

        if ($approved) {
            return true;
        }

        return AuditEvent::query()
            ->where('action', 'moderation.decided')
            ->where('target_type', $decision->getMorphClass())
            ->where('target_id', $decision->id)
            ->get(['after'])
            ->contains(function (AuditEvent $event) use ($staff): bool {
                $after = $event->getAttribute('after');
                $approvedBy = is_array($after) ? ($after['approved_by'] ?? null) : null;

                return is_scalar($approvedBy) && (string) $approvedBy === (string) $staff->id;
            });
    }

    /**
     * @param  array{action: DecisionAction, restriction: ?RestrictionType, until: ?CarbonImmutable, statement: Statement}|null  $measure
     */
    private function overturn(Staff $staff, Appeal $appeal, Decision $decision, string $explanation, string $reason, ?array $measure): Decision
    {
        if ($appeal->role === DecisionViewer::Affected) {
            if (! in_array($decision->action, [DecisionAction::RemoveContent, DecisionAction::Restrict, DecisionAction::Suspend], true)) {
                throw new DomainException('There is no measure to reverse.');
            }

            return $this->reverse->handle($decision, $staff, $explanation, $reason, $appeal);
        }

        if ($measure === null || ! in_array($measure['action'], [DecisionAction::RemoveContent, DecisionAction::Restrict], true)) {
            throw ValidationException::withMessages(['action' => [(string) __('validation.in', ['attribute' => 'action'])]]);
        }

        $case = ModerationCase::query()->findOrFail($decision->case_id);
        $target = CaseTargets::model($case);

        if ($target === null) {
            throw new DomainException('The content is gone.');
        }

        $statement = $measure['statement'];

        return $this->decide->handle($this->cases->forAppeal($target, $staff, $appeal), new DecisionInput(
            action: $measure['action'],
            facts: $statement->facts,
            ground: $statement->ground,
            groundDocument: $statement->groundDocument,
            groundSection: $statement->groundSection,
            restriction: $measure['action'] === DecisionAction::Restrict ? $measure['restriction'] : null,
            until: $measure['action'] === DecisionAction::Restrict ? $measure['until'] : null,
            decidedBy: $staff,
            reason: trim($reason),
        ));
    }
}
