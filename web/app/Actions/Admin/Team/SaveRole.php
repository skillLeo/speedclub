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
use App\Services\Team\TeamOutcome;
use App\Services\Team\TeamRefused;
use Database\Seeders\StaffSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * ADM-41 create or edit a role (`roles.manage`): name (3–60 characters, unique; seeded roles keep theirs), description, atoms. The atoms
 * go through ApplyPermissionMatrix with all its rules: a new role is created empty and then given its atoms, so sensitive ones wait for
 * the four-eyes `roles.sensitive_atoms` like any other grant. Owner and Admin are not editable.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class SaveRole
{
    public function __construct(private readonly ApplyPermissionMatrix $matrix) {}

    /**
     * @param  array<array-key, mixed>  $atoms
     */
    public function handle(Staff $by, ?Role $role, string $name, ?string $description, array $atoms, ?string $reason = null): TeamOutcome
    {
        StaffAtoms::ensure($by, 'roles.manage');
        $name = trim($name);
        $description = trim((string) $description) === '' ? null : trim((string) $description);
        $atoms = PermissionMatrix::validAtoms($atoms);

        if ($role !== null && in_array($role->name, PermissionMatrix::LOCKED_ROLES, true)) {
            throw new TeamRefused('role_locked', ['role' => (string) $role->name]);
        }

        Validator::make(['name' => $name, 'description' => $description], [
            'name' => ['required', 'string', 'min:3', 'max:60', 'regex:/\A[\pL\pN][\pL\pN _.\-]*\z/u'],
            'description' => ['nullable', 'string', 'max:500'],
        ])->validate();

        $same = Role::query()->where('guard_name', StaffSeeder::GUARD)->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);

        if ($role !== null) {
            $same->whereKeyNot($role->getKey());
        }

        $taken = $same->exists();

        if ($taken) {
            throw new TeamRefused('role_taken', ['role' => $name]);
        }

        if ($role !== null && $role->name !== $name && PermissionMatrix::isSystemRole((string) $role->name)) {
            throw new TeamRefused('role_system', ['role' => (string) $role->name]);
        }

        // SEC-P3-13: a pending role approval names roles; neither the named one nor a role taking that name may be renamed meanwhile.
        if ($role !== null && $role->name !== $name) {
            RolePins::ensureNotPending($role);

            if (in_array($name, RolePins::pendingNames(), true)) {
                throw new TeamRefused('role_pending_approval', ['role' => $name]);
            }
        }

        $created = $role === null;

        $role = DB::transaction(function () use ($by, $role, $name, $description, $reason): Role {
            $role ??= new Role;
            $before = $role->exists ? ['name' => $role->name, 'description' => $role->getAttribute('description')] : null;
            $role->forceFill(['name' => $name, 'guard_name' => StaffSeeder::GUARD, 'description' => $description])->save();

            $after = ['name' => $name, 'description' => $description];

            if ($before !== $after) {
                Audit::record(($before === null ? TeamEvent::RoleCreated : TeamEvent::RoleUpdated)->value, $role,
                    before: $before, after: $after, reason: Reason::optional($reason), actor: $by);
            }

            return $role;
        });

        $current = $role->permissions()->pluck('name')->map(fn (mixed $atom): string => (string) $atom)->sort()->values()->all();

        if ($current === $atoms) {
            return TeamOutcome::applied();
        }

        try {
            return $this->matrix->handle($by, [$name => $atoms], $reason);
        } catch (TeamRefused $refused) {
            if ($created && $refused->reason === 'unchanged') {
                return TeamOutcome::applied();
            }

            throw $refused;
        }
    }
}
