<?php

namespace App\Http\Controllers\Admin\Team;

use App\Enums\ApprovalStatus;
use App\Enums\StaffStatus;
use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Team\OwnerRules;
use App\Services\Team\RoleSets;
use App\Services\Team\StaffSessions;
use Database\Seeders\StaffSeeder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-40 staff detail (m3.6 §1): roles (with the atoms each one carries, so the page shows the atom diff of a change before it is asked),
 * state, second factor, sessions (by handle, device and last activity; never an id or an address), pending four-eyes requests about the
 * account, and the audit timeline of the account. What the viewer may do comes as `can`, so the page hides the rest (the server refuses it).
 */
class StaffShowController extends Controller
{
    public function __invoke(Request $request, string $staff, StaffSessions $sessions): Response
    {
        /** @var Staff $viewer */
        $viewer = $request->user('staff');
        $member = Staff::query()->with('roles:id,name')->findOrFail((int) $staff);
        $invite = StaffPresenter::openInvites([$member->id])[$member->id] ?? null;
        $state = StaffPresenter::state($member);
        $self = $member->id === $viewer->id;
        $editable = $member->anonymised_at === null;
        $ownerTouch = $member->isOwner();
        $mayOnOwner = ! $ownerTouch || $viewer->isOwner();
        $manage = $viewer->can('staff.manage') && $editable;

        return Inertia::render('Team/Show', [
            'member' => [
                ...StaffPresenter::row($member, $viewer, $invite),
                'deactivated_at' => $member->deactivated_at?->toIso8601String(),
                'two_factor_confirmed_at' => $member->two_factor_confirmed_at?->toIso8601String(),
                'privileged' => $member->isPrivileged(),
                'owner' => $ownerTouch,
                // In the order of 06 §2 (StaffSeeder::ATOMS), so the page groups them by area.
                'atoms' => array_values(array_intersect(StaffSeeder::ATOMS, RoleSets::atomsOf(RoleSets::of($member)))),
            ],
            'roles' => fn (): array => StaffPresenter::roleOptions(),
            'atomOrder' => StaffSeeder::ATOMS,
            'sessions' => fn (): array => $editable ? $sessions->list($member) : [],
            'pending' => fn (): array => self::pending($member),
            'activity' => fn (): array => ActivityFeed::for(['staff' => [(string) $member->id]], $viewer),
            'owners' => fn (): array => [
                'active' => Staff::query()->role('owner', 'staff')->where('status', StaffStatus::Active->value)->where('password_proof_required', false)->whereNull('anonymised_at')->count(),
                'max' => OwnerRules::maxOwners(),
            ],
            'can' => [
                'roles' => $manage && $state !== 'deactivated' && $mayOnOwner,
                'deactivate' => $manage && ! $self && $state !== 'deactivated' && $mayOnOwner,
                'reactivate' => $manage && $state === 'deactivated' && $mayOnOwner,
                'delete' => $manage && ! $self && $state === 'deactivated' && $mayOnOwner,
                'revoke_sessions' => $manage && ! $self && $state !== 'deactivated' && $mayOnOwner,
                'reset_two_factor' => $manage && ! $self && $viewer->isOwner() && $member->two_factor_confirmed_at !== null && $state === 'active',
                'resend_invite' => $viewer->can('staff.invite') && $state === 'invited' && $mayOnOwner,
                'viewer_is_owner' => $viewer->isOwner(),
            ],
        ]);
    }

    /**
     * Four-eyes requests still waiting about this account (role change, deactivation, deletion, reactivation, second-factor reset).
     *
     * @return list<array{id: string, action: string, title: string, requested_by: string|null, expires_at: string}>
     */
    private static function pending(Staff $member): array
    {
        return array_values(ApprovalRequest::query()
            ->with('requester:id,name')
            ->where('status', ApprovalStatus::Pending)
            ->where('expires_at', '>', now())
            ->where('subject_type', $member->getMorphClass())
            ->where('subject_id', (string) $member->id)
            ->latest()
            ->limit(10)
            ->get()
            ->map(fn (ApprovalRequest $request): array => [
                'id' => $request->id,
                'action' => $request->action,
                'title' => $request->summary['title'],
                'requested_by' => $request->requester->name ?? null,
                'expires_at' => $request->expires_at->toIso8601String(),
            ])->all());
    }
}
