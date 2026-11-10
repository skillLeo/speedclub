<?php

namespace App\Http\Controllers\Admin\Team;

use App\Enums\StaffStatus;
use App\Models\Role;
use App\Models\Staff;
use App\Models\StaffInvitation;
use App\Services\Team\PermissionMatrix;
use Carbon\CarbonImmutable;
use Database\Seeders\StaffSeeder;
use Illuminate\Support\Collection;

/**
 * Staff rows and role options for ADM-39…42. A staff member's address is a work address of the team, shown to staff.view holders; never
 * a password, a key, a recovery code or a session id.
 */
final class StaffPresenter
{
    /**
     * The state the UI shows: deleted (anonymised), invited (password not set through the link yet), or the account status.
     */
    public static function state(Staff $staff): string
    {
        return match (true) {
            $staff->anonymised_at !== null => 'deleted',
            $staff->status === StaffStatus::Active && $staff->password_proof_required => 'invited',
            default => $staff->status->value,
        };
    }

    /**
     * @param  list<Staff>  $staff  with roles loaded
     * @return list<array<string, mixed>>
     */
    public static function rows(array $staff, Staff $viewer): array
    {
        $invites = self::openInvites(array_map(fn (Staff $member): int => $member->id, $staff));

        return array_map(fn (Staff $member): array => self::row($member, $viewer, $invites[$member->id] ?? null), $staff);
    }

    /**
     * @return array<string, mixed>
     */
    public static function row(Staff $staff, Staff $viewer, ?StaffInvitation $invitation = null): array
    {
        return [
            'id' => $staff->id,
            'name' => $staff->name,
            'email' => $staff->anonymised_at === null ? $staff->email : null,
            'roles' => $staff->roles->pluck('name')->map(fn (mixed $name): string => (string) $name)->sort()->values()->all(),
            'state' => self::state($staff),
            'two_factor' => $staff->two_factor_confirmed_at !== null,
            'last_login_at' => self::time($staff->last_login_at),
            'created_at' => $staff->created_at?->toIso8601String(),
            'invite_expires_at' => $invitation !== null && $staff->password_proof_required ? $invitation->expires_at->toIso8601String() : null,
            'me' => $staff->id === $viewer->id,
        ];
    }

    /**
     * The newest open invitation per staff member (unused, not replaced; it may have expired).
     *
     * @param  list<int>  $ids
     * @return array<int, StaffInvitation>
     */
    public static function openInvites(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $open = [];
        foreach (StaffInvitation::query()->whereIn('staff_id', $ids)->whereNull('used_at')->whereNull('replaced_at')->orderBy('created_at')->get() as $invitation) {
            $open[$invitation->staff_id] = $invitation;
        }

        return $open;
    }

    /**
     * Every staff role with its description, whether it carries a four-eyes atom, and how many atoms (ADM-39 invite, ADM-40 roles).
     *
     * @return list<array{name: string, description: string|null, atoms: list<string>, sensitive: bool, locked: bool}>
     */
    public static function roleOptions(): array
    {
        /** @var Collection<int, Role> $roles */
        $roles = Role::query()->where('guard_name', StaffSeeder::GUARD)->with('permissions:id,name')->orderBy('id')->get();

        return array_values($roles->map(function (Role $role): array {
            /** @var list<string> $atoms */
            $atoms = $role->permissions->pluck('name')->map(fn (mixed $name): string => (string) $name)->sort()->values()->all();

            return [
                'name' => (string) $role->name,
                'description' => is_string($role->getAttribute('description')) ? $role->getAttribute('description') : null,
                'atoms' => $atoms,
                'sensitive' => in_array($role->name, PermissionMatrix::LOCKED_ROLES, true) || array_intersect($atoms, PermissionMatrix::SENSITIVE) !== [],
                'locked' => in_array($role->name, PermissionMatrix::LOCKED_ROLES, true),
            ];
        })->all());
    }

    private static function time(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? CarbonImmutable::parse($value, 'UTC')->toIso8601String() : ($value instanceof \DateTimeInterface ? CarbonImmutable::instance($value)->toIso8601String() : null);
    }
}
