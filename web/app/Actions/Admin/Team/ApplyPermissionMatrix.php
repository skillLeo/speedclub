<?php

namespace App\Actions\Admin\Team;

use App\Enums\TeamEvent;
use App\Models\ApprovalRequest;
use App\Models\Role;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use App\Services\Team\PermissionMatrix;
use App\Services\Team\RolePins;
use App\Services\Team\TeamOutcome;
use App\Services\Team\TeamRefused;
use Database\Seeders\StaffSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Spatie\Permission\PermissionRegistrar;

/**
 * ADM-42 "Speichern" of the permission matrix and ADM-41 atom edits (`roles.manage`, m3.6 §1). The page shows PermissionMatrix::diff()
 * first. Owner and Admin are not editable; nobody adds atoms to a role they hold themselves (self_elevation) or grants atoms they do not
 * hold. A change that grants a PermissionMatrix::SENSITIVE atom is four-eyes `roles.sensitive_atoms` (the whole change set, with the
 * atoms each role had, so an approval of a matrix that changed in between fails); a reason is required then. Removals and other
 * grants apply at once.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class ApplyPermissionMatrix
{
    public function __construct(private readonly PermissionMatrix $matrix, private readonly Approvals $approvals) {}

    /**
     * @param  array<array-key, mixed>  $proposed  role name => full atom list
     */
    public function handle(Staff $by, array $proposed, ?string $reason = null): TeamOutcome
    {
        StaffAtoms::ensure($by, 'roles.manage');
        $diff = $this->matrix->diff($proposed);

        if ($diff === []) {
            throw new TeamRefused('unchanged');
        }

        self::ensureMay($by, $diff);

        if (PermissionMatrix::sensitiveGrants($diff) !== []) {
            return TeamOutcome::approval($this->approvals->request('roles.sensitive_atoms', self::payload($diff), (string) $reason, $by));
        }

        $reason = Reason::optional($reason);
        DB::transaction(fn () => $this->apply($diff, $reason, $by, null));

        return TeamOutcome::applied();
    }

    /**
     * The executor of `roles.sensitive_atoms`, only inside its approval (FourEyes): each role must still carry the atoms it had.
     *
     * @throws AuthorizationException|TeamRefused|ValidationException
     */
    public function applyApproved(ApprovalRequest $request, Staff $requester, Staff $approver): void
    {
        FourEyes::executor(['roles.sensitive_atoms'], $requester, $approver, 'roles.manage');
        $diff = self::diffOf($request->payload);
        self::ensureMay($requester, $diff);

        $this->apply($diff, $request->reason, $requester, $approver);
    }

    /**
     * The diff an approval payload names, checked against the roles as they are now.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, array{added: list<string>, removed: list<string>, before: list<string>, staff: int}>
     *
     * @throws TeamRefused|ValidationException
     */
    public static function diffOf(array $payload): array
    {
        $matrix = app(PermissionMatrix::class);
        $proposed = [];
        /** @var array<string, array{before: list<string>, after: list<string>}> $changes */
        $changes = is_array($payload['changes'] ?? null) ? $payload['changes'] : [];
        // SEC-P3-13: the roles by id, atoms and holders as the request saw them; a rename into a named role or a new holder refuses.
        RolePins::check($payload['role_pins'] ?? null, array_map(strval(...), array_keys($changes)));

        foreach ($changes as $name => $change) {
            $role = Role::query()->where('guard_name', StaffSeeder::GUARD)->where('name', $name)->with('permissions')->first();

            if ($role === null || $matrix->atoms($role) !== $change['before']) {
                throw new TeamRefused('unchanged');
            }

            $proposed[$name] = $change['after'];
        }

        return $matrix->diff($proposed);
    }

    /**
     * @param  array<string, array{added: list<string>, removed: list<string>, before: list<string>, staff: int}>  $diff
     * @return array{changes: array<string, array{before: list<string>, after: list<string>}>, role_pins: array<string, array{id: int, atoms: list<string>, staff: list<int>}>}
     */
    public static function payload(array $diff): array
    {
        $changes = [];

        foreach ($diff as $name => $change) {
            $after = array_values(array_diff([...$change['before'], ...$change['added']], $change['removed']));
            sort($after);
            $changes[$name] = ['before' => $change['before'], 'after' => $after];
        }

        return ['changes' => $changes, 'role_pins' => RolePins::pin(array_map(strval(...), array_keys($changes)))];
    }

    /**
     * @param  array<string, array{added: list<string>, removed: list<string>, before: list<string>, staff: int}>  $diff
     *
     * @throws TeamRefused
     */
    private static function ensureMay(Staff $by, array $diff): void
    {
        foreach ($diff as $name => $change) {
            if ($change['added'] !== [] && $by->hasRole($name)) {
                throw new TeamRefused('self_elevation');
            }

            foreach ($change['added'] as $atom) {
                if (! $by->can($atom)) {
                    throw new TeamRefused('atoms_not_held', ['atom' => $atom]);
                }
            }
        }
    }

    /**
     * @param  array<string, array{added: list<string>, removed: list<string>, before: list<string>, staff: int}>  $diff
     */
    private function apply(array $diff, ?string $reason, Staff $requester, ?Staff $approver): void
    {
        foreach ($diff as $name => $change) {
            $role = Role::query()->where('guard_name', StaffSeeder::GUARD)->where('name', $name)->lockForUpdate()->firstOrFail();
            $role->givePermissionTo($change['added']);
            $role->revokePermissionTo($change['removed']);
        }

        DB::afterCommit(fn () => app(PermissionRegistrar::class)->forgetCachedPermissions());
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        Audit::record(TeamEvent::PermissionsChanged->value, null,
            before: array_map(fn (array $change): array => ['atoms' => $change['before']], $diff),
            after: [
                'changes' => array_map(fn (array $change): array => ['added' => $change['added'], 'removed' => $change['removed'], 'staff' => $change['staff']], $diff),
                'requested_by' => $requester->getKey(),
                'approved_by' => $approver?->getKey(),
            ],
            reason: $reason, actor: $approver ?? $requester);
    }
}
