<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Team\ApplyPermissionMatrix;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\ConcernsStaff;
use App\Services\Approvals\FourEyes;
use App\Services\Team\PermissionMatrix;
use App\Services\Team\RolePins;
use App\Services\Team\TeamRefused;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * roles.sensitive_atoms (m3.6 §1): a permission-matrix change that grants roles.manage, approvals.decide, members.delete,
 * members.export, audit.export or maintenance.toggle to a role. Payload {changes: {role: {before, after}}}. At approval every role must
 * still carry its `before` atoms. Executes ApplyPermissionMatrix::applyApproved(). Nobody approves a change that gives atoms to a role they
 * hold themselves (ConcernsStaff, SF-3 of the M3.4-batch review): that would be approving their own elevation.
 */
final class GrantSensitiveAtoms implements ApprovalHandler, ConcernsStaff
{
    public function __construct(private readonly ApplyPermissionMatrix $matrix) {}

    public function key(): string
    {
        return 'roles.sensitive_atoms';
    }

    public function atom(): string
    {
        return 'roles.manage';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'changes' => ['required', 'array', 'min:1'],
            'changes.*.before' => ['present', 'array'],
            'changes.*.after' => ['present', 'array'],
        ])->validate();

        try {
            $diff = ApplyPermissionMatrix::diffOf($payload);
        } catch (TeamRefused $refused) {
            throw ValidationException::withMessages(['changes' => [(string) __('team.refused.changed')]]);
        }

        if (PermissionMatrix::sensitiveGrants($diff) === []) {
            throw ValidationException::withMessages(['changes' => [(string) __('team.refused.changed')]]);
        }
    }

    /**
     * Whether $staff holds a role that this change gives atoms to.
     */
    public function concerns(array $payload, Staff $staff): bool
    {
        /** @var array<string, mixed> $changes */
        $changes = is_array($payload['changes'] ?? null) ? $payload['changes'] : [];

        foreach ($changes as $role => $change) {
            $before = is_array($change) && is_array($change['before'] ?? null) ? $change['before'] : [];
            $after = is_array($change) && is_array($change['after'] ?? null) ? $change['after'] : [];

            if (array_diff($after, $before) !== [] && $staff->hasRole((string) $role)) {
                return true;
            }
        }

        return false;
    }

    public function describe(array $payload): array
    {
        $lines = [];
        /** @var array<string, array{before?: list<string>, after?: list<string>}> $changes */
        $changes = is_array($payload['changes'] ?? null) ? $payload['changes'] : [];

        foreach ($changes as $role => $change) {
            $before = $change['before'] ?? [];
            $after = $change['after'] ?? [];
            $lines[] = [
                'label' => 'approvals.roles_sensitive_atoms.role',
                'before' => (string) $role,
                'after' => '+ '.implode(', ', array_diff($after, $before)).(array_diff($before, $after) === [] ? '' : ' / − '.implode(', ', array_diff($before, $after))),
            ];
        }

        // SEC-P3-13: how many people the grant reaches, as pinned at the request.
        $lines[] = ['label' => 'approvals.roles_sensitive_atoms.staff', 'after' => (string) RolePins::staffCount($payload['role_pins'] ?? null)];

        return ['title' => 'approvals.roles_sensitive_atoms.title', 'subject_label' => implode(', ', array_keys($changes)), 'lines' => $lines];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'roles.sensitive_atoms');
        $this->matrix->applyApproved($request, Staff::query()->findOrFail($request->requested_by), $approver);

        return ['roles' => array_keys(is_array($request->payload['changes'] ?? null) ? $request->payload['changes'] : [])];
    }
}
