<?php

namespace App\Actions\Admin\Team;

use App\Enums\TeamEvent;
use App\Models\Role;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use App\Services\Team\PermissionMatrix;
use App\Services\Team\RolePins;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Spatie\Permission\PermissionRegistrar;

/**
 * ADM-41 "Rolle löschen" (`roles.manage`, with reason): only a custom role nobody holds (seeded roles stay: role_system).
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class DeleteRole
{
    public function handle(Staff $by, Role $role, string $reason): void
    {
        StaffAtoms::ensure($by, 'roles.manage');
        $reason = Reason::required($reason);

        if (PermissionMatrix::isSystemRole((string) $role->name)) {
            throw new TeamRefused('role_system', ['role' => (string) $role->name]);
        }

        // SEC-P3-13: not while a pending role approval names it.
        RolePins::ensureNotPending($role);

        DB::transaction(function () use ($by, $role, $reason): void {
            $locked = Role::query()->whereKey($role->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->users()->exists()) {
                throw new TeamRefused('role_in_use', ['role' => (string) $locked->name]);
            }

            $before = ['name' => $locked->name, 'description' => $locked->getAttribute('description'), 'atoms' => $locked->permissions()->pluck('name')->all()];
            $locked->delete();
            DB::afterCommit(fn () => app(PermissionRegistrar::class)->forgetCachedPermissions());

            Audit::record(TeamEvent::RoleDeleted->value, $locked, before: $before, reason: $reason, actor: $by);
        });
    }
}
