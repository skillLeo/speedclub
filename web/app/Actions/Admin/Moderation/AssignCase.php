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
use Illuminate\Validation\ValidationException;

/**
 * ADM-20/21 "Übernehmen" and reassignment (m3.4-contract §1): sets the case's staff member and moves a new case into review. Taking a
 * case and handing it to a colleague both need moderation.decide; the colleague must be active and hold it too. Only open cases.
 * Audited `moderation.case_assigned` with before and after.
 *
 * @throws AuthorizationException|DomainException|ValidationException
 */
class AssignCase
{
    public function handle(Staff $by, ModerationCase $case, ?Staff $to = null): ModerationCase
    {
        StaffAtoms::ensure($by, 'moderation.decide');
        $to ??= $by;

        if (! $to->isActive() || ! $to->can('moderation.decide')) {
            throw ValidationException::withMessages(['staff_id' => [(string) __('validation.exists', ['attribute' => 'staff'])]]);
        }

        return DB::transaction(function () use ($by, $case, $to): ModerationCase {
            $locked = ModerationCase::query()->whereKey($case->id)->lockForUpdate()->firstOrFail();

            if (! $locked->status->isOpen()) {
                throw new DomainException('The case is not open.');
            }

            $before = ['assigned_staff_id' => $locked->assigned_staff_id, 'status' => $locked->status->value];

            $locked->forceFill([
                'assigned_staff_id' => $to->id,
                'status' => CaseStatus::InReview,
            ])->save();

            Audit::record('moderation.case_assigned', $locked, $before, ['assigned_staff_id' => $to->id, 'status' => $locked->status->value], actor: $by);

            return $locked;
        });
    }
}
