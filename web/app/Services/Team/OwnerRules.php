<?php

namespace App\Services\Team;

use App\Enums\StaffStatus;
use App\Models\Role;
use App\Models\Staff;
use Database\Seeders\StaffSeeder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The Owner rules of 06_ADMIN_SPEC §2 (m3.6 §1): at least one active Owner, at most speedclub.team.max_owners Owners that are not
 * deactivated, under a lock. Every step that adds or removes the Owner role, or ends or revives an Owner account, calls lock() first
 * inside its transaction: the `owner` role row is the one lock all of them queue on, then the Owner rows are read with locking reads,
 * so two such steps never both pass on the same count.
 *
 * An "active" Owner is active and has set a password (an invited Owner cannot sign in yet).
 */
final class OwnerRules
{
    /** Roles that make a staff member privileged: deactivating them is four-eyes (06 §2). */
    public const PRIVILEGED_ROLES = ['owner', 'admin'];

    /**
     * Locks the Owner role and returns the current Owners (any status), locked.
     *
     * @return Collection<int, Staff>
     */
    public function lock(): Collection
    {
        $role = Role::query()->where('name', 'owner')->where('guard_name', StaffSeeder::GUARD)->lockForUpdate()->firstOrFail();

        $ids = DB::table(config()->string('permission.table_names.model_has_roles'))
            ->where('role_id', $role->getKey())
            ->where('model_type', (new Staff)->getMorphClass())
            ->lockForUpdate()
            ->pluck('model_id');

        return Staff::query()->whereKey($ids->all())->orderBy('id')->lockForUpdate()->get();
    }

    public static function maxOwners(): int
    {
        return max(1, config()->integer('speedclub.team.max_owners'));
    }

    public static function isActiveOwner(Staff $staff): bool
    {
        return $staff->status === StaffStatus::Active && ! $staff->password_proof_required && $staff->anonymised_at === null;
    }

    /**
     * $staff may become (or come back as) an Owner without exceeding the maximum.
     *
     * @param  Collection<int, Staff>  $owners  from lock()
     *
     * @throws TeamRefused
     */
    public function ensureRoomFor(Collection $owners, Staff $staff): void
    {
        $counted = $owners->filter(fn (Staff $owner): bool => $owner->status !== StaffStatus::Deactivated && $owner->anonymised_at === null
            && $owner->getKey() !== $staff->getKey());

        if ($counted->count() + 1 > self::maxOwners()) {
            throw new TeamRefused('max_owners', ['max' => self::maxOwners()]);
        }
    }

    /**
     * $staff stops being an active Owner (demoted, deactivated, deleted): another active Owner must remain.
     *
     * @param  Collection<int, Staff>  $owners  from lock()
     *
     * @throws TeamRefused
     */
    public function ensureNotLastActive(Collection $owners, Staff $staff): void
    {
        if (! $owners->contains(fn (Staff $owner): bool => $owner->getKey() === $staff->getKey())) {
            return;
        }

        $others = $owners->filter(fn (Staff $owner): bool => $owner->getKey() !== $staff->getKey() && self::isActiveOwner($owner));

        if ($others->isEmpty()) {
            throw new TeamRefused('last_owner');
        }
    }
}
