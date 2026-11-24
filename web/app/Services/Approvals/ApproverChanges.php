<?php

namespace App\Services\Approvals;

use App\Enums\ApproverChangeCause;
use App\Models\ApproverChange;
use App\Models\Staff;
use Illuminate\Support\Carbon;
use Spatie\Permission\PermissionRegistrar;

/**
 * SEC-P5-01 (ADR-507): the record of every staff action that took approval rights from someone who held `approvals.decide`, so the
 * Owner-Override can wait a cool-down (speedclub.approvals.override_cooldown_hours) after the latest one. Without it one Owner could
 * strip the only other approver's atom, override, and give the atom back, unnoticed.
 *
 * Callers look BEFORE the change: watch() (the atoms of everyone who held approvals.decide) → recordLosses() after it, for
 * ApplyPermissionMatrix (atoms removed from a role) and ChangeStaffRoles (atoms lost through a role change); deciders() → record() for
 * DeactivateStaff and ResetStaffTwoFactor. Deleting staff needs no row: only a deactivated account is deleted, and its deactivation was recorded.
 */
final class ApproverChanges
{
    /**
     * The ids of $staff who are active and hold approvals.decide now.
     *
     * @param  iterable<Staff>  $staff
     * @return list<int>
     */
    public static function deciders(iterable $staff): array
    {
        $ids = [];

        foreach ($staff as $member) {
            if ($member->isActive() && $member->anonymised_at === null && $member->can('approvals.decide')) {
                $ids[] = (int) $member->getKey();
            }
        }

        return $ids;
    }

    /**
     * The atoms of each of $staff who holds approvals.decide now, for recordLosses() after a role or atom change.
     *
     * @param  iterable<Staff>  $staff
     * @return array<int, list<string>>
     */
    public static function watch(iterable $staff): array
    {
        $atoms = [];

        foreach ($staff as $member) {
            if (in_array((int) $member->getKey(), self::deciders([$member]), true)) {
                $atoms[(int) $member->getKey()] = self::atomsOf($member);
            }
        }

        return $atoms;
    }

    /**
     * Records everyone of watch() who lost an atom (or their active status) through the change that ran in between.
     *
     * @param  array<int, list<string>>  $watched
     */
    public static function recordLosses(array $watched, ApproverChangeCause $cause, ?Staff $by): void
    {
        if ($watched === []) {
            return;
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $now = Staff::query()->whereKey(array_keys($watched))->with(['roles.permissions', 'permissions'])->get()->keyBy(fn (Staff $staff): int => (int) $staff->getKey());
        $lost = [];

        foreach ($watched as $id => $atoms) {
            $member = $now->get($id);
            $after = $member instanceof Staff && $member->isActive() ? self::atomsOf($member) : [];

            if (array_diff($atoms, $after) !== []) {
                $lost[] = $id;
            }
        }

        self::record($lost, $cause, $by);
    }

    /**
     * @return list<string>
     */
    private static function atomsOf(Staff $staff): array
    {
        return array_values($staff->getAllPermissions()->map(fn (mixed $permission): string => (string) data_get($permission, 'name'))->all());
    }

    /**
     * @param  list<int>  $staffIds  from deciders(), taken before the change
     */
    public static function record(array $staffIds, ApproverChangeCause $cause, ?Staff $by): void
    {
        foreach (array_values(array_unique($staffIds)) as $id) {
            $change = new ApproverChange;
            $change->forceFill(['staff_id' => $id, 'cause' => $cause, 'changed_by' => $by?->getKey(), 'created_at' => now()])->save();
        }
    }

    /**
     * Until when the Owner-Override waits: the latest change plus the cool-down, or null when that moment has passed (or nothing changed).
     */
    public function cooldownUntil(): ?Carbon
    {
        $hours = max(0, config()->integer('speedclub.approvals.override_cooldown_hours'));
        $latest = ApproverChange::query()->where('created_at', '>', now()->subHours($hours))->max('created_at');

        if ($latest === null) {
            return null;
        }

        $until = Carbon::parse((string) $latest)->addHours($hours);

        return $until->isFuture() ? $until : null;
    }
}
