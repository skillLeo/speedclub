<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Enums\RestrictionType;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\BulkOutcome;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Moderation\Statement;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * ADM-09 bulk (m3.1-contract §0): `POST /admin/members/bulk {action, ids[≤500], reason, …}` with
 *
 * - restrict (`members.restrict`, recent password; options type, until?, facts, ground, ground_document, ground_section?): one decision
 *   per member through RestrictMember;
 * - revoke_sessions (`members.revoke_sessions`, recent password) through RevokeMemberSessions;
 * - export (`members.export`) and delete (`members.delete`): always four-eyes, through ExportMemberData and DeleteMemberAsStaff.
 *
 * Four-eyes (06 §2 "bulk action affecting > 100 records", ADR-214) asks for the approval of `members.bulk` instead of running: for
 * export and delete at any count, and when this run plus what the same staff member ran of the same action without an approval in the
 * last 24 hours passes 100 records (SF-4 / SEC-P3-08: splitting into runs of 100 does not dodge it), or while another run of theirs of
 * the same action is still going. Its handler calls execute() from Approvals::approve(), nowhere else (FourEyes). Every record runs in
 * its own transaction with its own event (BulkRunner); one `member.bulk_executed` event sums the run (`records`, `done`, `failed`).
 */
class BulkMemberAction
{
    public const ACTIONS = ['restrict', 'revoke_sessions', 'export', 'delete'];

    public const ATOMS = [
        'restrict' => 'members.restrict',
        'revoke_sessions' => 'members.revoke_sessions',
        'export' => 'members.export',
        'delete' => 'members.delete',
    ];

    private const ALWAYS_FOUR_EYES = ['export', 'delete'];

    public function __construct(
        private readonly Approvals $approvals,
        private readonly RestrictMember $restrict,
        private readonly RevokeMemberSessions $revoke,
        private readonly ExportMemberData $export,
        private readonly DeleteMemberAsStaff $delete,
    ) {}

    /**
     * @param  array<mixed>  $ids
     * @param  array<string, mixed>  $options
     *
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, string $action, array $ids, string $reason, array $options = []): BulkOutcome
    {
        self::validate($action, $options);
        StaffAtoms::ensure($staff, self::ATOMS[$action]);
        $ids = BulkRunner::ids($ids);
        $options = self::options($action, $options);
        $ask = fn (): BulkOutcome => new BulkOutcome(approval: $this->approvals->request('members.bulk', [
            'action' => $action,
            'ids' => $ids,
            'options' => $options,
        ], $reason, $staff));

        if (in_array($action, self::ALWAYS_FOUR_EYES, true)) {
            return $ask();
        }

        return BulkRunner::alone($staff, 'members.'.$action, $ask, function () use ($staff, $action, $ids, $reason, $options, $ask): BulkOutcome {
            if (count($ids) + BulkRunner::recentDirect($staff, AdminMemberEvent::BulkExecuted->value, $action) > BulkRunner::APPROVAL_ABOVE) {
                return $ask();
            }

            return new BulkOutcome($this->run($staff, null, $action, $ids, trim($reason), $options));
        });
    }

    /**
     * The approved run: only from the `members.bulk` handler while Approvals::approve() executes that request, with its requester,
     * approver, action and ids (FourEyes). Anything else is refused.
     *
     * @param  list<string>  $ids
     * @param  array<string, mixed>  $options
     * @return list<array{id: string, ok: bool, code: string|null}>
     *
     * @throws AuthorizationException
     */
    public function execute(Staff $requester, ?Staff $approver, string $action, array $ids, string $reason, array $options): array
    {
        if ($approver === null || ! isset(self::ATOMS[$action])) {
            throw new AuthorizationException;
        }

        $approval = FourEyes::executor(['members.bulk'], $requester, $approver, self::ATOMS[$action]);

        if (($approval->payload['action'] ?? null) !== $action) {
            throw new AuthorizationException;
        }

        FourEyes::ids($approval, $ids);

        return $this->run($requester, $approver, $action, $ids, $reason, $options);
    }

    /**
     * @param  list<string>  $ids
     * @param  array<string, mixed>  $options
     * @return list<array{id: string, ok: bool, code: string|null}>
     */
    private function run(Staff $requester, ?Staff $approver, string $action, array $ids, string $reason, array $options): array
    {
        $rows = BulkRunner::each($ids, function (string $id) use ($requester, $approver, $action, $reason, $options): bool {
            $member = User::query()->find($id);

            if (! $member instanceof User) {
                return false;
            }

            match ($action) {
                'restrict' => $this->restrict->handle(
                    $requester,
                    $member,
                    RestrictionType::from((string) $options['type']),
                    is_string($options['until'] ?? null) ? CarbonImmutable::parse($options['until']) : null,
                    Statement::fromArray($options),
                    $reason,
                ),
                'revoke_sessions' => $this->revoke->handle($requester, $member, $reason),
                'export' => $this->export->handle($requester, $approver ?? $requester, $member, $reason),
                default => $this->delete->handle($requester, $approver ?? $requester, $member, $reason),
            };

            return true;
        });

        $outcome = new BulkOutcome($rows);

        DB::transaction(fn () => Audit::record(AdminMemberEvent::BulkExecuted->value, null, after: [
            'action' => $action,
            'records' => count($ids),
            ...$outcome->counts(),
            'requested_by' => $requester->getKey(),
            'approved_by' => $approver?->getKey(),
        ], reason: $reason, actor: $approver ?? $requester));

        return $rows;
    }

    /**
     * @param  array<string, mixed>  $options
     *
     * @throws ValidationException
     */
    public static function validate(string $action, array $options): void
    {
        Validator::make(['action' => $action, ...$options], [
            'action' => ['required', Rule::in(self::ACTIONS)],
            ...($action === 'restrict' ? [
                'type' => ['required', Rule::enum(RestrictionType::class)],
                'until' => ['nullable', 'date', 'after:now'],
                ...Statement::rules(),
            ] : []),
        ])->validate();
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function options(string $action, array $options): array
    {
        if ($action !== 'restrict') {
            return [];
        }

        return [
            'type' => $options['type'],
            'until' => is_string($options['until'] ?? null) ? CarbonImmutable::parse($options['until'])->toIso8601String() : null,
            ...Statement::fromArray($options)->toArray(),
        ];
    }
}
