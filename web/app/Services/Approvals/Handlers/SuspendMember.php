<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Moderation\DecideCase;
use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Models\ApprovalRequest;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Models\User;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\FourEyes;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\OwnInitiativeCases;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * moderation.suspend (ADR-206 a, ADR-214, SEC-P2-10): a staff-decided suspension of the member a case is about. The requester is the
 * deciding operator (decided_by, the audit actor of moderation.decided), the approver the second staff member (approved_by), each in
 * their own signed-in session. The subject of the request is the case, so one case has at most one pending suspension.
 *
 * M3.2 (ADM-10 "Sperren", m3.2-contract §1): instead of case_id the payload may name member_id (subject: the member). On approval the
 * member's open case, or a new own-initiative case, is decided. A moderator as requester suspends for at most 30 days (DecisionInput
 * refuses a longer one, so the request fails).
 *
 * Payload: case_id | member_id, facts, ground, ground_document (community|terms|law), ground_section?, until? (ISO 8601, future; none = no end),
 * automated_detection?, automated_decision?. The request's reason becomes the decision's audit reason.
 */
final class SuspendMember implements ApprovalHandler
{
    public function __construct(
        private readonly DecideCase $decide,
        private readonly OwnInitiativeCases $cases,
    ) {}

    public function key(): string
    {
        return 'moderation.suspend';
    }

    public function atom(): string
    {
        return 'members.suspend';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'case_id' => ['required_without:member_id', 'prohibits:member_id', 'string', 'size:26'],
            'member_id' => ['required_without:case_id', 'string', 'size:26'],
            'facts' => ['required', 'string', 'min:10', 'max:5000'],
            'ground' => ['required', 'string', 'min:3', 'max:2000'],
            'ground_document' => ['required', Rule::enum(GroundDocument::class)],
            'ground_section' => ['nullable', 'string', 'max:100'],
            'until' => ['nullable', 'date', 'after:now'],
            'automated_detection' => ['sometimes', 'boolean'],
            'automated_decision' => ['sometimes', 'boolean'],
        ])->validate();

        if (isset($payload['member_id'])) {
            $member = $this->member($payload);

            if ($member === null || $member->isDeactivated()) {
                throw ValidationException::withMessages(['member_id' => ['There is no account to suspend.']]);
            }

            return;
        }

        $case = $this->case($payload);

        if ($case === null || ! $case->status->isOpen()) {
            throw ValidationException::withMessages(['case_id' => ['The case is not open.']]);
        }

        $member = $case->subject_id === null ? null : User::query()->find($case->subject_id);

        if ($member === null) {
            throw ValidationException::withMessages(['case_id' => ['There is no account to suspend.']]);
        }
    }

    public function describe(array $payload): array
    {
        $case = $this->case($payload);
        $member = isset($payload['member_id'])
            ? User::withTrashed()->find(self::string($payload, 'member_id'))
            : ($case?->subject_id === null ? null : User::withTrashed()->find($case->subject_id));
        $section = is_string($payload['ground_section'] ?? null) ? ' '.$payload['ground_section'] : '';

        return [
            'title' => 'approvals.moderation_suspend.title',
            'subject_label' => $member?->username === null ? null : '@'.$member->username,
            'lines' => [
                // Null for a suspension asked from the member record (M3.2): its case is opened on approval.
                ['label' => 'approvals.moderation_suspend.case', 'after' => $case?->id],
                ['label' => 'approvals.moderation_suspend.until', 'after' => is_string($payload['until'] ?? null) ? CarbonImmutable::parse($payload['until'])->toIso8601String() : null],
                ['label' => 'approvals.moderation_suspend.ground', 'after' => self::string($payload, 'ground_document').$section],
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'moderation.suspend');
        $payload = $request->payload;
        $requester = Staff::query()->findOrFail($request->requested_by);
        $member = isset($payload['member_id']) ? $this->member($payload) : null;

        $case = match (true) {
            isset($payload['member_id']) => $member instanceof User
                ? $this->cases->forTarget($member, $requester)
                : throw ValidationException::withMessages(['member_id' => ['The account is gone.']]),
            default => $this->case($payload) ?? throw ValidationException::withMessages(['case_id' => ['The case is gone.']]),
        };

        $decision = $this->decide->handle($case, new DecisionInput(
            action: DecisionAction::Suspend,
            facts: self::string($payload, 'facts'),
            ground: self::string($payload, 'ground'),
            groundDocument: GroundDocument::from(self::string($payload, 'ground_document')),
            groundSection: is_string($payload['ground_section'] ?? null) ? $payload['ground_section'] : null,
            automatedDetection: (bool) ($payload['automated_detection'] ?? false),
            automatedDecision: (bool) ($payload['automated_decision'] ?? false),
            until: is_string($payload['until'] ?? null) ? CarbonImmutable::parse($payload['until']) : null,
            decidedBy: $requester,
            reason: $request->reason,
            approvedBy: $approver,
        ));

        return ['decision_id' => $decision->id, 'case_id' => $case->id];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function member(array $payload): ?User
    {
        $id = $payload['member_id'] ?? null;

        return is_string($id) ? User::query()->find($id) : null;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function case(array $payload): ?ModerationCase
    {
        $id = $payload['case_id'] ?? null;

        return is_string($id) ? ModerationCase::query()->find($id) : null;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private static function string(array $payload, string $key): string
    {
        $value = $payload[$key] ?? '';

        return is_string($value) ? $value : '';
    }
}
