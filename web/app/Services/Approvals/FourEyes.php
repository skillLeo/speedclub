<?php

namespace App\Services\Approvals;

use App\Enums\ApprovalStatus;
use App\Enums\DecisionAction;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Moderation\DecisionInput;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use LogicException;

/**
 * The four-eyes rule as a check, not a convention (MF-1 of the M3.1 review, SEC-P3-10, ADR-214). A four-eyes executor runs only while
 * Approvals::approve() executes a request for its own action: the request, its requester and its approver must be the ones approve()
 * locked and checked (Approvals::executing(), set only there). Two valid staff members passed in by any other caller are refused.
 *
 * - handler(): first line of every handler's execute(): the very request and approver approve() handed over;
 * - executor(): first line of every executor Action (ResetMemberTwoFactor, DeleteMemberAsStaff, ExportMemberData, the bulk execute());
 * - member(): the member the executor acts on is the one the request names (or one of the ids of a member bulk request);
 * - suspension(): DecideCase for a staff suspension: inside the `moderation.suspend` approval, or the operator command (ADR-206 a).
 */
final class FourEyes
{
    private static bool $operatorCommand = false;

    /**
     * @throws AuthorizationException
     */
    public static function handler(ApprovalRequest $request, Staff $approver, string $action): void
    {
        $execution = Approvals::executing();

        if ($execution === null || $execution->request !== $request || $execution->approver !== $approver || $request->action !== $action) {
            throw new AuthorizationException('A four-eyes action runs only inside its approval.');
        }
    }

    /**
     * The approval approve() is executing now, when it is for one of $actions, asked by $requester and approved by $approver, two
     * different people who both (still) hold $atoms.
     *
     * @param  list<string>  $actions
     *
     * @throws AuthorizationException
     */
    public static function executor(array $actions, Staff $requester, Staff $approver, string ...$atoms): ApprovalRequest
    {
        $execution = Approvals::executing();
        $request = $execution?->request;

        if ($execution === null || $request === null
            || ! in_array($request->action, $actions, true)
            || ! in_array($request->status, [ApprovalStatus::Pending, ApprovalStatus::Executing], true)
            || $request->requested_by !== $requester->getKey()
            || $execution->approver->getKey() !== $approver->getKey()) {
            throw new AuthorizationException('A four-eyes action runs only inside its approval.');
        }

        StaffAtoms::ensurePair($requester, $approver, ...$atoms);

        return $request;
    }

    /**
     * The member is the subject of the request: payload member_id, or for `members.bulk` one of its ids with the same bulk action.
     *
     * @throws AuthorizationException
     */
    public static function member(ApprovalRequest $request, User $member, string $bulkAction): void
    {
        $payload = $request->payload;

        $named = $request->action === 'members.bulk'
            ? ($payload['action'] ?? null) === $bulkAction && is_array($payload['ids'] ?? null) && in_array($member->id, $payload['ids'], true)
            : ($payload['member_id'] ?? null) === $member->id;

        if (! $named) {
            throw new AuthorizationException('The approval names another member.');
        }
    }

    /**
     * The ids are exactly the request's (order aside).
     *
     * @param  list<string>  $ids
     *
     * @throws AuthorizationException
     */
    public static function ids(ApprovalRequest $request, array $ids): void
    {
        $approved = is_array($request->payload['ids'] ?? null) ? array_map(strval(...), $request->payload['ids']) : [];
        sort($approved);
        sort($ids);

        if ($approved !== $ids) {
            throw new AuthorizationException('The approval names other records.');
        }
    }

    /**
     * A suspension decided by staff (DecideCase) needs its approval: `moderation.suspend` executing now, with the deciding staff member
     * as requester and $approvedBy as approver. The operator command (ADR-206 a, CLI only) is the one other way. A suspension without
     * a deciding staff member (the system: seeder, tests, jobs) is refused on the web.
     *
     * @throws AuthorizationException
     */
    public static function suspension(DecisionInput $input): void
    {
        if ($input->action !== DecisionAction::Suspend) {
            return;
        }

        if (self::$operatorCommand && app()->runningInConsole()) {
            return;
        }

        if ($input->decidedBy === null) {
            if (app()->runningInConsole()) {
                return;
            }

            throw new AuthorizationException('A suspension on the web is decided by staff, with an approval.');
        }

        if ($input->approvedBy === null) {
            throw new AuthorizationException('A suspension by staff needs its approval.');
        }

        self::executor(['moderation.suspend'], $input->decidedBy, $input->approvedBy, 'members.suspend');
    }

    /**
     * Runs $run as the operator command speedclub:moderation:decide (ADR-206 a: operator and approver named on the server's console).
     * Refused anywhere but the console.
     *
     * @template T
     *
     * @param  Closure(): T  $run
     * @return T
     */
    public static function asOperatorCommand(Closure $run): mixed
    {
        if (! app()->runningInConsole()) {
            throw new LogicException('Only the operator command runs outside an approval.');
        }

        $previous = self::$operatorCommand;
        self::$operatorCommand = true;

        try {
            return $run();
        } finally {
            self::$operatorCommand = $previous;
        }
    }
}
