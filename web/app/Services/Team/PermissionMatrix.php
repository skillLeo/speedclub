<?php

namespace App\Services\Team;

use App\Enums\StaffStatus;
use App\Models\Role;
use Database\Seeders\StaffSeeder;
use Illuminate\Validation\ValidationException;

/**
 * ADM-42 permission matrix (role × atom, m3.6 §1). Owner and Admin keep every atom and are not editable. diff() is what the page shows
 * before saving (added/removed per role, staff affected); granting any SENSITIVE atom to a role is four-eyes (`roles.sensitive_atoms`).
 */
final class PermissionMatrix
{
    /** Granting one of these to any role needs a second staff member (m3.6 §1). */
    public const SENSITIVE = ['roles.manage', 'approvals.decide', 'members.delete', 'members.export', 'audit.export', 'maintenance.toggle'];

    public const LOCKED_ROLES = ['owner', 'admin'];

    /**
     * @return array{atoms: list<string>, sensitive: list<string>, roles: list<array{name: string, description: string|null, locked: bool, system: bool, atoms: list<string>, staff: int}>}
     */
    public function matrix(): array
    {
        $roles = array_values(Role::query()->where('guard_name', StaffSeeder::GUARD)->with('permissions')->orderBy('id')->get()
            ->map(fn (Role $role): array => [
                'name' => (string) $role->name,
                'description' => is_string($role->getAttribute('description')) ? $role->getAttribute('description') : null,
                'locked' => in_array($role->name, self::LOCKED_ROLES, true),
                'system' => self::isSystemRole((string) $role->name),
                'atoms' => $this->atoms($role),
                'staff' => $this->staffCount($role),
            ])->all());

        return ['atoms' => StaffSeeder::ATOMS, 'sensitive' => self::SENSITIVE, 'roles' => $roles];
    }

    /**
     * The change from the current matrix to $proposed (role name => full atom list), only for roles named in $proposed and changing.
     *
     * @param  array<array-key, mixed>  $proposed
     * @return array<string, array{added: list<string>, removed: list<string>, before: list<string>, staff: int}>
     *
     * @throws ValidationException|TeamRefused
     */
    public function diff(array $proposed): array
    {
        $diff = [];

        foreach ($proposed as $name => $atoms) {
            $role = Role::query()->where('guard_name', StaffSeeder::GUARD)->where('name', (string) $name)->with('permissions')->first();

            if ($role === null) {
                throw ValidationException::withMessages(['roles' => [(string) __('team.validation.role_unknown', ['role' => (string) $name])]]);
            }

            if (in_array($role->name, self::LOCKED_ROLES, true)) {
                throw new TeamRefused('role_locked', ['role' => (string) $role->name]);
            }

            $next = self::validAtoms(is_array($atoms) ? $atoms : []);
            $before = $this->atoms($role);
            $added = array_values(array_diff($next, $before));
            $removed = array_values(array_diff($before, $next));

            if ($added !== [] || $removed !== []) {
                $diff[(string) $role->name] = ['added' => $added, 'removed' => $removed, 'before' => $before, 'staff' => $this->staffCount($role)];
            }
        }

        ksort($diff);

        return $diff;
    }

    /**
     * The sensitive atoms a diff grants.
     *
     * @param  array<string, array{added: list<string>, removed: list<string>, before: list<string>, staff: int}>  $diff
     * @return list<string>
     */
    public static function sensitiveGrants(array $diff): array
    {
        $atoms = [];

        foreach ($diff as $change) {
            $atoms = [...$atoms, ...array_intersect($change['added'], self::SENSITIVE)];
        }

        $atoms = array_values(array_unique($atoms));
        sort($atoms);

        return $atoms;
    }

    /**
     * Sorted, unique, known atoms.
     *
     * @param  array<array-key, mixed>  $atoms
     * @return list<string>
     *
     * @throws ValidationException
     */
    public static function validAtoms(array $atoms): array
    {
        $atoms = array_values(array_unique(array_map(strval(...), $atoms)));
        $unknown = array_diff($atoms, StaffSeeder::ATOMS);

        if ($unknown !== []) {
            throw ValidationException::withMessages(['atoms' => [(string) __('team.validation.atom_unknown', ['atoms' => implode(', ', $unknown)])]]);
        }

        sort($atoms);

        return $atoms;
    }

    /** Seeded roles: their names are used by the seeders and the e2e harness, so they are never renamed or deleted. */
    public static function isSystemRole(string $name): bool
    {
        return in_array($name, [...self::LOCKED_ROLES, ...array_keys(StaffSeeder::ROLES)], true);
    }

    /**
     * @return list<string>
     */
    public function atoms(Role $role): array
    {
        /** @var list<string> $atoms */
        $atoms = $role->permissions->pluck('name')->map(fn (mixed $name): string => (string) $name)->sort()->values()->all();

        return $atoms;
    }

    /** Staff holding the role who are not deactivated: who a change reaches. */
    public function staffCount(Role $role): int
    {
        return $role->users()->where('status', '!=', StaffStatus::Deactivated->value)->whereNull('anonymised_at')->count();
    }
}
