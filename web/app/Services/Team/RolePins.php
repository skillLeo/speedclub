<?php

namespace App\Services\Team;

use App\Enums\ApprovalStatus;
use App\Models\ApprovalRequest;
use App\Models\Role;
use App\Models\Staff;
use Database\Seeders\StaffSeeder;
use Illuminate\Support\Facades\DB;

/**
 * SEC-P3-13: a four-eyes request about roles (`roles.sensitive_atoms`, `staff.role_elevation`) pins each role it names by id, with its
 * atoms and the staff who hold it, so the approver approves exactly what they saw. At execution check() refuses (`changed`) when a
 * named role is gone, now carries a different id (renamed into the name) or other atoms, and, for a grant to the role, when other
 * people hold it. While such a request is
 * pending, the roles it names cannot be renamed or deleted (pendingNames(), SaveRole, DeleteRole: 409 `role_pending_approval`).
 *
 * @phpstan-type Pin array{id: int, atoms: list<string>, staff: list<int>}
 */
final class RolePins
{
    /** The approvals whose payload names roles. */
    public const ACTIONS = ['roles.sensitive_atoms', 'staff.role_elevation'];

    /**
     * @param  list<string>  $names
     * @return array<string, Pin>
     */
    public static function pin(array $names): array
    {
        $pins = [];

        foreach (array_values(array_unique($names)) as $name) {
            $role = self::role($name);

            if ($role !== null) {
                $pins[$name] = ['id' => (int) $role->getKey(), 'atoms' => self::atoms($role), 'staff' => self::holders($role)];
            }
        }

        return $pins;
    }

    /**
     * @param  mixed  $pins  from an approval payload
     * @param  list<string>  $names  the roles the payload acts on: each must be pinned
     * @param  bool  $holders  also refuse when other people hold a role now (a grant to the role reaches them; a staff member's own role
     *                         change does not, so `staff.role_elevation` checks id and atoms only)
     *
     * @throws TeamRefused
     */
    public static function check(mixed $pins, array $names, bool $holders = true): void
    {
        if (! is_array($pins)) {
            throw new TeamRefused('changed');
        }

        foreach (array_values(array_unique($names)) as $name) {
            $pin = $pins[$name] ?? null;
            $role = self::role($name);

            if (! is_array($pin) || $role === null
                || (int) $role->getKey() !== (int) ($pin['id'] ?? 0)
                || self::atoms($role) !== ($pin['atoms'] ?? null)
                || ($holders && self::holders($role) !== ($pin['staff'] ?? null))) {
                throw new TeamRefused('changed');
            }
        }
    }

    /**
     * Names of the roles a pending (or executing) role approval names.
     *
     * @return list<string>
     */
    public static function pendingNames(): array
    {
        $names = [];

        $requests = ApprovalRequest::query()
            ->whereIn('action', self::ACTIONS)
            ->whereIn('status', [ApprovalStatus::Pending, ApprovalStatus::Executing])
            ->get();

        foreach ($requests as $request) {
            $payload = $request->payload;
            $names = [
                ...$names,
                ...array_keys(is_array($payload['changes'] ?? null) ? $payload['changes'] : []),
                ...array_keys(is_array($payload['role_pins'] ?? null) ? $payload['role_pins'] : []),
                ...(is_array($payload['roles'] ?? null) && array_is_list($payload['roles']) ? $payload['roles'] : []),
                ...(is_array($payload['before'] ?? null) ? $payload['before'] : []),
            ];
        }

        return array_values(array_unique(array_map(fn (mixed $name): string => (string) $name, $names)));
    }

    /**
     * @throws TeamRefused
     */
    public static function ensureNotPending(Role $role): void
    {
        if (in_array((string) $role->name, self::pendingNames(), true)) {
            throw new TeamRefused('role_pending_approval', ['role' => (string) $role->name]);
        }
    }

    /** How many staff members hold any of the pinned roles. */
    public static function staffCount(mixed $pins): int
    {
        $ids = [];

        foreach (is_array($pins) ? $pins : [] as $pin) {
            $ids = [...$ids, ...(is_array($pin) && is_array($pin['staff'] ?? null) ? $pin['staff'] : [])];
        }

        return count(array_unique($ids));
    }

    private static function role(string $name): ?Role
    {
        return Role::query()->where('guard_name', StaffSeeder::GUARD)->where('name', $name)->with('permissions')->first();
    }

    /**
     * @return list<string>
     */
    private static function atoms(Role $role): array
    {
        $atoms = $role->permissions->pluck('name')->map(fn (mixed $atom): string => (string) $atom)->all();
        sort($atoms);

        return $atoms;
    }

    /**
     * @return list<int>
     */
    private static function holders(Role $role): array
    {
        $ids = DB::table(config()->string('permission.table_names.model_has_roles'))
            ->where('role_id', $role->getKey())
            ->where('model_type', (new Staff)->getMorphClass())
            ->pluck('model_id')
            ->map(fn (mixed $id): int => (int) $id)
            ->all();
        sort($ids);

        return $ids;
    }
}
