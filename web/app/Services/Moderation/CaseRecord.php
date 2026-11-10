<?php

namespace App\Services\Moderation;

use App\Enums\AppealStatus;
use App\Enums\DecisionAction;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\Appeal;
use App\Models\BuildUpdate;
use App\Models\Decision;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Report;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Admin\Members\MemberRecord;
use App\Services\Garage\VehiclePresenter;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

/**
 * What ADM-21 (and the detail pane of ADM-22) shows of a case (m3.4-contract §2): the case with its priority parts, the target as members
 * see it now, every report (reason, details, source; the notifier's contact only when given, the address always masked, revealed to
 * members.view_pii through RevealReportContact, SEC-P3-25), the decision and its appeals, the member's earlier decisions and the case's history from the audit log.
 *
 * Never here: message content. A message case shows no preview at all and its report details only to staff with moderation.messages
 * (the details may quote the message); the reported message and its context come only from CaseEvidence, audited per opening. The
 * evidence snapshot of any target (reports.evidence) is never a prop either.
 */
class CaseRecord
{
    public function __construct(private readonly VehiclePresenter $presenter) {}

    /**
     * @return Builder<ModerationCase>
     */
    public static function query(CarbonImmutable $now): Builder
    {
        return CasePriority::select(ModerationCase::query()->select([]), $now);
    }

    public static function find(string $id, CarbonImmutable $now): ?ModerationCase
    {
        return self::query($now)->where('moderation_cases.id', strtolower($id))->first();
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(ModerationCase $case, Staff $staff): array
    {
        $case->loadMissing(['assignedStaff:id,name', 'subject:id,username,display_name,status,deleted_at', 'firstReport']);
        $label = $case->target_label ?? $case->firstReport?->target_label;
        $assigned = $case->assignedStaff;

        return [
            'id' => $case->id,
            'reference' => strtoupper(substr($case->id, -8)),
            'status' => $case->status->value,
            'origin' => $case->origin->value,
            'target_type' => $case->target_type->value,
            'target_id' => $case->target_id,
            'target_label' => $label,
            'subject' => $case->subject instanceof User ? ['id' => $case->subject->id, 'username' => $case->subject->username, 'deleted' => $case->subject->trashed()] : null,
            'assigned' => $assigned instanceof Staff ? ['id' => $assigned->id, 'name' => $assigned->name, 'me' => $assigned->id === $staff->id] : null,
            'report_count' => $case->report_count,
            'automated_detection' => self::automatedDetection($case),
            'ai_score' => $case->ai_score === null ? null : round((float) $case->ai_score, 2),
            'ai_summary' => $case->ai_summary,
            'appeal_id' => $case->appeal_id,
            'priority' => CasePriority::parts($case),
            'created_at' => $case->created_at?->toIso8601String(),
            'decided_at' => $case->decided_at?->toIso8601String(),
        ];
    }

    /**
     * DSA Art. 17(3)(c), ADR-243: detected by automated means only when a keyword rule filed it (`automated`) or a staff case was opened on a
     * photo the triage flagged (`ai_detected`). A score on a case members reported detected nothing.
     */
    public static function automatedDetection(ModerationCase $case): bool
    {
        return $case->automated || $case->ai_detected;
    }

    /**
     * The target as members see it now; null for a message (ADM-22 only) and for a target that is gone.
     *
     * @return array<string, mixed>|null
     */
    public function preview(ModerationCase $case): ?array
    {
        if ($case->target_type === ReportTargetType::Message) {
            return null;
        }

        $target = CaseTargets::model($case);

        return match (true) {
            $target instanceof User => [
                'kind' => 'member',
                'username' => $target->username,
                'display_name' => $target->getAttribute('display_name'),
                'bio' => $target->getAttribute('bio'),
                'avatar' => MediaUrls::at($target->avatar, 160),
                'status' => $target->status->value,
                'deleted' => $target->trashed(),
            ],
            $target instanceof Vehicle => [
                'kind' => 'vehicle',
                'id' => $target->id,
                'title' => $this->presenter->fullTitle($target),
                'nickname' => $target->getAttribute('nickname'),
                'description' => $target->getAttribute('description'),
                'cover' => MediaUrls::at($target->cover, 640),
                'visibility' => $target->visibility->value,
                'status' => $target->status->value,
                'deleted' => $target->trashed(),
            ],
            $target instanceof Media => [
                'kind' => 'photo',
                'id' => $target->id,
                'url' => MediaUrls::at($target, 640),
                'alt' => $target->getAttribute('alt'),
                'width' => $target->getAttribute('width'),
                'height' => $target->getAttribute('height'),
                'moderation_status' => $target->moderation_status->value,
                'vehicle_id' => $target->getAttribute('mediable_type') === 'vehicle' ? $target->getAttribute('mediable_id') : null,
            ],
            $target instanceof BuildUpdate => [
                'kind' => 'build_update',
                'vehicle_id' => $target->vehicle_id,
                'type' => $target->type->value,
                'note' => $target->getAttribute('note'),
                'hidden' => (bool) $target->getAttribute('hidden'),
                'created_at' => $target->created_at?->toIso8601String(),
            ],
            $target instanceof Modification => [
                'kind' => 'modification',
                'vehicle_id' => $target->vehicle_id,
                'title' => $target->getAttribute('title'),
                'brand' => $target->getAttribute('brand_text'),
                'part_name' => $target->getAttribute('part_name'),
                'deleted' => $target->trashed(),
            ],
            default => null,
        };
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function reports(ModerationCase $case, Staff $staff): array
    {
        $details = $case->target_type !== ReportTargetType::Message || $staff->can('moderation.messages');
        $pii = $staff->can('members.view_pii');

        return array_values(Report::query()->where('case_id', $case->id)->with('reporter:id,username,deleted_at')->orderBy('created_at')->orderBy('id')->get()
            ->map(fn (Report $report): array => [
                'id' => $report->id,
                'source' => $report->source->value,
                'reason' => $report->reason->value,
                'sub_reason' => $report->sub_reason?->value,
                'details' => $details ? $report->details : null,
                'details_withheld' => ! $details && $report->details !== null,
                'good_faith' => $report->good_faith,
                'reporter' => $report->reporter instanceof User ? ['id' => $report->reporter->id, 'username' => $report->reporter->username] : null,
                // The web notifier's contact, only when they gave one. SEC-P3-25: the address is always masked here; a members.view_pii
                // holder reveals it through the audited, capped JSON answer (RevealReportContact), never through the page props.
                'contact' => $report->source === ReportSource::WebForm && ($report->contact_name !== null || $report->contact_email !== null) ? [
                    'name' => $report->contact_name,
                    'email' => $report->contact_email === null ? null : MemberRecord::maskEmail($report->contact_email),
                ] : null,
                'can_reveal_contact' => $pii && $report->source === ReportSource::WebForm && is_string($report->contact_email) && $report->contact_email !== '',
                'created_at' => $report->created_at->toIso8601String(),
            ])->all());
    }

    /**
     * @return array<string, mixed>|null
     */
    public function decision(ModerationCase $case, Staff $staff): ?array
    {
        $decision = Decision::query()->where('case_id', $case->id)->with(['decider:id,name', 'reversal:id,reverses_decision_id,decided_at'])->first();

        if (! $decision instanceof Decision) {
            return null;
        }

        $appeals = Appeal::query()->where('decision_id', $decision->id)->with(['appellant:id,username,deleted_at'])->orderBy('created_at')->orderBy('id')->get();
        $deciders = Staff::query()->whereIn('id', $appeals->pluck('decided_by')->filter()->all())->pluck('name', 'id');
        $readsAppeals = $staff->can('moderation.appeals');

        return [
            'id' => $decision->id,
            'action' => $decision->action->value,
            'restriction' => $decision->restriction,
            'facts' => $decision->facts(),
            'ground' => $decision->ground(),
            'ground_document' => $decision->groundDocument()->value,
            'ground_section' => $decision->groundSection(),
            'automated_detection' => $decision->automatedDetection(),
            'automated_decision' => $decision->automatedDecision(),
            'decided_by' => $decision->decider instanceof Staff ? ['id' => $decision->decider->id, 'name' => $decision->decider->name, 'me' => $decision->decider->id === $staff->id] : null,
            'decided_at' => $decision->decided_at->toIso8601String(),
            'appeal_until' => $decision->appealUntil()?->toIso8601String(),
            'reverses_decision_id' => $decision->reverses_decision_id,
            'reversed_by' => $decision->reversal instanceof Decision ? ['id' => $decision->reversal->id, 'decided_at' => $decision->reversal->decided_at->toIso8601String()] : null,
            'appeals' => array_values($appeals->map(fn (Appeal $appeal): array => [
                'id' => $appeal->id,
                'role' => $appeal->role->value,
                'status' => $appeal->status->value,
                'appellant' => $appeal->appellant instanceof User ? $appeal->appellant->username : null,
                // The complaint text is for whoever decides appeals.
                'text' => $readsAppeals ? $appeal->text : null,
                'created_at' => $appeal->created_at->toIso8601String(),
                'decided_at' => $appeal->decided_at?->toIso8601String(),
                'decided_by' => $appeal->decided_by === null ? null : ($deciders[$appeal->decided_by] ?? null),
                // Appeals are decided by another person than the decider (Art. 20(6) DSA).
                'may_decide' => $appeal->status === AppealStatus::Open && $readsAppeals && $decision->decided_by !== $staff->id,
            ])->all()),
        ];
    }

    /**
     * The member's other decisions (newest first, at most 20): what they were, when, about which case.
     *
     * @return list<array{id: string, case_id: string, action: string, target_type: string, decided_at: string, reversed: bool}>
     */
    public function prior(ModerationCase $case): array
    {
        if ($case->subject_id === null) {
            return [];
        }

        $decisions = Decision::query()->with('case:id,target_type')->where('subject_id', $case->subject_id)->where('case_id', '!=', $case->id)
            ->orderByDesc('decided_at')->orderByDesc('id')->limit(20)->get();
        $reversed = Decision::query()->whereIn('reverses_decision_id', $decisions->pluck('id')->all())->pluck('reverses_decision_id')->all();

        return array_values($decisions->map(fn (Decision $decision): array => [
            'id' => $decision->id,
            'case_id' => $decision->case_id,
            'action' => $decision->action->value,
            'target_type' => $decision->case instanceof ModerationCase ? $decision->case->target_type->value : ReportTargetType::Member->value,
            'decided_at' => $decision->decided_at->toIso8601String(),
            'reversed' => in_array($decision->id, $reversed, true),
        ])->all());
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function history(ModerationCase $case, Staff $staff): array
    {
        $decisions = array_values(Decision::query()->where('case_id', $case->id)->pluck('id')->map(fn (mixed $id): string => (string) $id)->all());
        $appeals = $decisions === [] ? [] : array_values(Appeal::query()->whereIn('decision_id', $decisions)->pluck('id')->map(fn (mixed $id): string => (string) $id)->all());

        return ActivityFeed::for(['moderation_case' => [$case->id], 'decision' => $decisions, 'appeal' => $appeals], $staff, 40);
    }

    /**
     * What the composer offers for this case: the actions the target allows, and whether a suspension needs the approval.
     *
     * @return array<string, mixed>
     */
    public function composer(ModerationCase $case, Staff $staff): array
    {
        $member = $case->subject_id !== null && User::query()->whereKey($case->subject_id)->exists();
        $actions = [DecisionAction::NoAction->value, DecisionAction::RemoveContent->value];

        if ($member) {
            $actions[] = DecisionAction::Restrict->value;

            if ($staff->can('members.suspend')) {
                $actions[] = DecisionAction::Suspend->value;
            }
        }

        $subject = $case->subject_id === null ? null : User::withTrashed()->find($case->subject_id);
        $locale = $subject instanceof User && is_string($subject->getAttribute('locale')) ? $subject->getAttribute('locale') : 'de';

        return [
            'actions' => $actions,
            'member_locale' => in_array($locale, ['de', 'en'], true) ? $locale : 'de',
            'max_suspension_days' => SuspensionLimit::isLimited($staff) ? SuspensionLimit::MODERATOR_MAX_DAYS : null,
            'automated_detection' => self::automatedDetection($case),
            'automated_decision' => false,
            'placeholders' => $this->placeholders($case, $subject),
        ];
    }

    /**
     * The values of the template placeholders for this case.
     *
     * @return array{target: string, date: string, member: string}
     */
    public function placeholders(ModerationCase $case, ?User $subject = null): array
    {
        $first = Report::query()->where('case_id', $case->id)->orderBy('created_at')->orderBy('id')->first(['target_label', 'created_at']);
        $label = $case->target_label ?? ($first === null ? null : $first->target_label) ?? '';
        $date = ($first === null ? ($case->created_at ?? now()) : $first->created_at)->setTimezone(config()->string('speedclub.display_timezone'))->format('d.m.Y');

        return [
            'target' => $label,
            'date' => $date,
            'member' => $subject?->username === null ? '' : '@'.$subject->username,
        ];
    }
}
