<?php

namespace App\Http\Controllers\Admin\Team;

use App\Actions\Admin\Team\DeleteRole;
use App\Actions\Admin\Team\SaveRole;
use App\Http\Controllers\Admin\Team\Requests\DeleteRoleRequest;
use App\Http\Controllers\Admin\Team\Requests\RoleRequest;
use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Services\Team\PermissionMatrix;
use Database\Seeders\StaffSeeder;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-41 roles (m3.6 §1): the seeded roles and custom ones with description, atom count and how many active staff hold each; custom roles
 * are created, edited (atoms through the matrix rules, so a four-eyes atom waits for `roles.sensitive_atoms`) and deleted when nobody holds
 * them. Owner and Admin keep every atom; seeded roles keep their name.
 */
class RolesController extends Controller
{
    use TeamResponses;

    public function index(PermissionMatrix $matrix): Response
    {
        return Inertia::render('Team/Roles', [
            'matrix' => fn (): array => $matrix->matrix(),
            'ids' => fn (): array => Role::query()->where('guard_name', StaffSeeder::GUARD)->pluck('id', 'name')->all(),
        ]);
    }

    public function store(RoleRequest $request, SaveRole $save): RedirectResponse
    {
        return $this->persist($request, $save, null, 'team.flash.role_created');
    }

    public function update(RoleRequest $request, string $role, SaveRole $save): RedirectResponse
    {
        return $this->persist($request, $save, self::find($role), 'team.flash.role_saved');
    }

    public function destroy(DeleteRoleRequest $request, string $role, DeleteRole $delete): RedirectResponse
    {
        return $this->step(fn () => $delete->handle($request->staff(), self::find($role), $request->reason()), 'team.flash.role_deleted');
    }

    private function persist(RoleRequest $request, SaveRole $save, ?Role $role, string $flash): RedirectResponse
    {
        /** @var list<string> $atoms */
        $atoms = $request->array('atoms');

        return $this->step(fn () => $save->handle(
            $request->staff(),
            $role,
            $request->string('name')->value(),
            $request->filled('description') ? $request->string('description')->value() : null,
            $atoms,
            $request->filled('reason') ? $request->string('reason')->value() : null,
        ), $flash);
    }

    private static function find(string $id): Role
    {
        return Role::query()->where('guard_name', StaffSeeder::GUARD)->findOrFail((int) $id);
    }
}
