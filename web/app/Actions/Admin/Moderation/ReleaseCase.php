<?php

namespace App\Actions\Admin\Moderation;

use App\Enums\CaseStatus;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * The 5-s undo of "Übernehmen" in the ADM-20 SplitQueue (09 §10.2): puts back the assignee and status the case had before this staff
 * member took it. Only the taker, only while the case is still open and theirs; a former assignee who lost moderation.decide or left
 * leaves the case unassigned. A DSA decision has no such undo: it is sent to the member and the reporters at once (DecideCase), so it is
 * corrected only by an appeal (ADM-24). Audited `moderation.case_released`.
 *
 * @throws AuthorizationException|DomainException
 */
final class ReleaseCase
{
    /**
     * @param  array{assigned_staff_id: int|null, status: string}  $before  what AssignCase replaced
     */
    public function handle(Staff $staff, ModerationCase $case, array $before): ModerationCase
    {
        StaffAtoms::ensure($staff, 'moderation.decide');

        return DB::transaction(function () use ($staff, $case, $before): ModerationCase {
            $locked = ModerationCase::query()->whereKey($case->id)->lockForUpdate()->firstOrFail();

            if (! $locked->status->isOpen() || (int) $locked->assigned_staff_id !== (int) $staff->id) {
                throw new DomainException('The case is no longer yours to release.');
            }

            $previous = $before['assigned_staff_id'] === null ? null : Staff::query()->find($before['assigned_staff_id']);
            $assignee = $previous !== null && $previous->isActive() && $previous->can('moderation.decide') ? $previous->id : null;
            $status = CaseStatus::tryFrom($before['status']) === CaseStatus::New && $assignee === null ? CaseStatus::New : CaseStatus::InReview;
            $now = ['assigned_staff_id' => $locked->assigned_staff_id, 'status' => $locked->status->value];

            $locked->forceFill(['assigned_staff_id' => $assignee, 'status' => $status])->save();

            Audit::record('moderation.case_released', $locked, $now, ['assigned_staff_id' => $assignee, 'status' => $status->value], actor: $staff);

            return $locked;
        });
    }
}
