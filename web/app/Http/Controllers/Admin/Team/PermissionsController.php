<?php

namespace App\Http\Controllers\Admin\Team;

use App\Actions\Admin\Team\ApplyPermissionMatrix;
use App\Http\Controllers\Admin\Team\Requests\PermissionMatrixRequest;
use App\Http\Controllers\Controller;
use App\Services\Team\PermissionMatrix;
use App\Services\Team\TeamRefused;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-42 permission matrix (role × atom, m3.6 §1). The page asks for the diff first (added and removed atoms per role, staff affected,
 * whether it is four-eyes), shows it in a dialog, then saves: removals and plain grants apply at once, a grant of a four-eyes atom
 * becomes the approval `roles.sensitive_atoms`. Owner and Admin are not editable.
 */
class PermissionsController extends Controller
{
    use TeamResponses;

    public function index(PermissionMatrix $matrix): Response
    {
        return Inertia::render('Team/Permissions', ['matrix' => fn (): array => $matrix->matrix()]);
    }

    public function diff(PermissionMatrixRequest $request, PermissionMatrix $matrix): JsonResponse
    {
        try {
            $diff = $matrix->diff($request->matrix());
        } catch (TeamRefused $refused) {
            return response()->json(['message' => $refused->getMessage(), 'code' => $refused->reason], $refused->status());
        }

        return response()->json([
            'diff' => (object) $diff,
            'sensitive' => PermissionMatrix::sensitiveGrants($diff),
            'staff' => array_sum(array_column($diff, 'staff')),
        ]);
    }

    public function update(PermissionMatrixRequest $request, ApplyPermissionMatrix $apply): RedirectResponse
    {
        return $this->step(fn () => $apply->handle($request->staff(), $request->matrix(), $request->filled('reason') ? $request->string('reason')->value() : null), 'team.flash.permissions_saved');
    }
}
