<?php

namespace App\Http\Controllers\Api\V1\Crews;

use App\Actions\Crews\CrewRoles;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Crews\CrewRoleRequest;
use App\Http\Requests\Api\V1\Crews\CrewUsernameRequest;
use App\Http\Resources\V1\Crews\CrewMemberResource;
use App\Http\Resources\V1\Crews\CrewResource;
use App\Models\User;
use App\Services\Crews\CrewListing;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Who is who in a crew (contract-crews.md §3 #24–26): removing members, admin roles, handing over the founder role.
 */
class CrewMemberController extends Controller
{
    use FindsCrews;

    /**
     * Remove a member.
     *
     * The founder removes anyone but themselves; an admin only plain members (403). The member is not told. Answers 204.
     */
    public function destroy(Request $request, string $slug, string $username, CrewRoles $roles): Response
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('update', $crew);
        $roles->remove($user, $crew, $this->membership($crew, $username));

        return response()->noContent();
    }

    /**
     * Change a member's role.
     *
     * The founder makes a member admin, or an admin member again. The founder's own role changes only by a hand-over (422).
     */
    public function update(CrewRoleRequest $request, string $slug, string $username, CrewRoles $roles, CrewListing $listing): CrewMemberResource
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('manage', $crew);
        $member = $roles->changeRole($user, $crew, $this->membership($crew, $username), $request->role());
        $listing->attachVehicles([$member], $user);

        return new CrewMemberResource($member);
    }

    /**
     * Hand over the founder role.
     *
     * The founder names a member of the crew (`username`), who becomes founder; the old founder stays as admin. 409 limit_reached when
     * that member already founds 2 crews.
     */
    public function handOver(CrewUsernameRequest $request, string $slug, CrewRoles $roles): CrewResource
    {
        /** @var User $user */
        $user = $request->user();
        $crew = $this->crew($slug, $user);
        Gate::authorize('manage', $crew);
        $roles->handOver($user, $crew, $this->membership($crew, $request->username()));

        return $this->present($crew->refresh(), $user);
    }
}
