<?php

namespace App\Http\Controllers\Admin\Team;

use App\Actions\Admin\Team\ChangeStaffRoles;
use App\Actions\Admin\Team\DeactivateStaff;
use App\Actions\Admin\Team\DeleteStaff;
use App\Actions\Admin\Team\InviteStaff;
use App\Actions\Admin\Team\ReactivateStaff;
use App\Actions\Admin\Team\ResendStaffInvite;
use App\Actions\Admin\Team\ResetStaffTwoFactor;
use App\Actions\Admin\Team\RevokeStaffSessions;
use App\Http\Controllers\Admin\Team\Requests\InviteStaffRequest;
use App\Http\Controllers\Admin\Team\Requests\ResendInviteRequest;
use App\Http\Controllers\Admin\Team\Requests\StaffRolesRequest;
use App\Http\Controllers\Admin\Team\Requests\StaffSessionsRequest;
use App\Http\Controllers\Admin\Team\Requests\StaffStepRequest;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\RedirectResponse;

/**
 * ADM-39/40 writes (m3.6 §1). Each: FormRequest (atom, reason) → the Team Action with all its Owner and four-eyes rules → back with a
 * flash. Four-eyes steps (role elevation or Admin demotion, deactivating an Owner/Admin, deleting or reactivating an Owner, the second-
 * factor reset) only ask for the approval and answer with the flash `approval`; their executors run in the approval handlers, never here.
 * Recent password on the routes (ADR-215).
 */
class StaffActionsController extends Controller
{
    use TeamResponses;

    public function invite(InviteStaffRequest $request, InviteStaff $invite): RedirectResponse
    {
        /** @var list<string> $roles */
        $roles = $request->array('roles');

        return $this->step(fn () => $invite->handle(
            $request->staff(),
            $request->string('name')->value(),
            $request->string('email')->value(),
            $roles,
            $request->filled('reason') ? $request->string('reason')->value() : null,
            $request->string('locale')->value(),
        ), 'team.flash.invited');
    }

    public function resendInvite(ResendInviteRequest $request, string $staff, ResendStaffInvite $resend): RedirectResponse
    {
        $locale = $request->filled('locale') ? $request->string('locale')->value() : app()->getLocale();

        return $this->step(fn () => $resend->handle($request->staff(), self::find($staff), $locale), 'team.flash.invite_resent');
    }

    public function roles(StaffRolesRequest $request, string $staff, ChangeStaffRoles $change): RedirectResponse
    {
        /** @var list<string> $roles */
        $roles = $request->array('roles');

        return $this->step(fn () => $change->handle($request->staff(), self::find($staff), $roles, $request->filled('reason') ? $request->string('reason')->value() : null), 'team.flash.roles_changed');
    }

    public function deactivate(StaffStepRequest $request, string $staff, DeactivateStaff $deactivate): RedirectResponse
    {
        return $this->step(fn () => $deactivate->handle($request->staff(), self::find($staff), $request->reason()), 'team.flash.deactivated');
    }

    public function reactivate(StaffStepRequest $request, string $staff, ReactivateStaff $reactivate): RedirectResponse
    {
        return $this->step(fn () => $reactivate->handle($request->staff(), self::find($staff), $request->reason()), 'team.flash.reactivated');
    }

    public function destroy(StaffStepRequest $request, string $staff, DeleteStaff $delete): RedirectResponse
    {
        $target = self::find($staff);
        $response = $this->step(fn () => $delete->handle($request->staff(), $target, $request->reason()), 'team.flash.deleted');

        return $response;
    }

    public function revokeSessions(StaffSessionsRequest $request, string $staff, RevokeStaffSessions $revoke): RedirectResponse
    {
        return $this->step(fn () => $revoke->handle($request->staff(), self::find($staff), $request->filled('reason') ? $request->reason() : null), 'team.flash.sessions_revoked');
    }

    public function resetTwoFactor(StaffStepRequest $request, string $staff, ResetStaffTwoFactor $reset): RedirectResponse
    {
        return $this->step(fn () => $reset->handle($request->staff(), self::find($staff), $request->reason()), 'team.flash.two_factor_reset');
    }

    private static function find(string $id): Staff
    {
        return Staff::query()->findOrFail((int) $id);
    }
}
