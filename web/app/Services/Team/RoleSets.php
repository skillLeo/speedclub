<?php

namespace App\Services\Team;

use App\Models\Role;
use App\Models\Staff;
use Database\Seeders\StaffSeeder;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Role sets of staff members (ADM-39/40): validation, the atoms a set carries, and whether a change elevates (m3.6 §1: a role change
 * that grants Admin/Owner or a four-eyes atom, or takes Admin away, is four-eyes, A4).
 */
final class RoleSets
{
    /**
     * Unique, sorted, existing staff roles.
     *
     * @param  array<array-key, mixed>  $names
     * @return list<string>
     *
     * @throws ValidationException
     */
    public static function validate(array $names, bool $allowEmpty = false): array
    {
        Validator::make(['roles' => $names], [
            'roles' => [$allowEmpty ? 'present' : 'required', 'array', 'max:20'],
            'roles.*' => ['string', Rule::exists(config()->string('permission.table_names.roles'), 'name')->where('guard_name', StaffSeeder::GUARD)],
        ])->validate();

        /** @var list<string> $names */
        $names = array_values(array_unique(array_map(strval(...), $names)));
        sort($names);

        return $names;
    }

    /**
     * @return list<string>
     */
    public static function of(Staff $staff): array
    {
        /** @var list<string> $names */
        $names = $staff->roles()->pluck('name')->map(fn (mixed $name): string => (string) $name)->sort()->values()->all();

        return $names;
    }

    /**
     * Every atom the roles carry.
     *
     * @param  list<string>  $roles
     * @return list<string>
     */
    public static function atomsOf(array $roles): array
    {
        if ($roles === []) {
            return [];
        }

        /** @var list<string> $atoms */
        $atoms = Role::query()->where('guard_name', StaffSeeder::GUARD)->whereIn('name', $roles)->with('permissions')->get()
            ->flatMap(fn (Role $role) => $role->permissions->pluck('name'))
            ->map(fn (mixed $name): string => (string) $name)->unique()->sort()->values()->all();

        return $atoms;
    }

    /**
     * Grants Owner or Admin, or one of the four-eyes atoms of the permission matrix (PermissionMatrix::SENSITIVE, `roles.manage` among
     * them), that $before did not carry. A custom role that carries such an atom elevates like granting the atom itself (SF-2 of the
     * M3.4-batch review): otherwise one Admin could hand out `approvals.decide` through a role without a second person.
     *
     * @param  list<string>  $before
     * @param  list<string>  $after
     */
    public static function elevates(array $before, array $after): bool
    {
        if (array_diff(array_intersect($after, OwnerRules::PRIVILEGED_ROLES), $before) !== []) {
            return true;
        }

        return self::sensitiveGrants($before, $after) !== [];
    }

    /**
     * The four-eyes atoms (PermissionMatrix::SENSITIVE) that $after carries and $before does not.
     *
     * @param  list<string>  $before
     * @param  list<string>  $after
     * @return list<string>
     */
    public static function sensitiveGrants(array $before, array $after): array
    {
        $added = array_diff(self::atomsOf($after), self::atomsOf($before));

        return array_values(array_intersect(PermissionMatrix::SENSITIVE, $added));
    }

    /**
     * Takes the Admin role away (SF-6 of the M3.4-batch review): like deactivating an Admin (06 §2 four-eyes list), so four-eyes too.
     *
     * @param  list<string>  $before
     * @param  list<string>  $after
     */
    public static function demotesAdmin(array $before, array $after): bool
    {
        return in_array('admin', $before, true) && ! in_array('admin', $after, true);
    }

    /**
     * @param  list<string>  $before
     * @param  list<string>  $after
     */
    public static function touchesOwner(array $before, array $after): bool
    {
        return in_array('owner', $before, true) || in_array('owner', $after, true);
    }

    /**
     * Nobody grants what they do not hold themselves.
     *
     * @param  list<string>  $atoms
     *
     * @throws TeamRefused
     */
    public static function ensureHolds(Staff $by, array $atoms): void
    {
        foreach ($atoms as $atom) {
            if (! $by->can($atom)) {
                throw new TeamRefused('atoms_not_held', ['atom' => $atom]);
            }
        }
    }
}
