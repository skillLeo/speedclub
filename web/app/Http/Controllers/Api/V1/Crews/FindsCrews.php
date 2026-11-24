<?php

namespace App\Http\Controllers\Api\V1\Crews;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Resources\V1\Crews\CrewResource;
use App\Models\Crew;
use App\Models\CrewMember;
use App\Models\User;
use App\Services\Crews\CrewLookup;
use App\Services\Crews\CrewViewerState;

/**
 * Crews by route slug (CrewLookup: 404 crew_unavailable for anything the reader may not see) and members by username.
 */
trait FindsCrews
{
    private function crew(string $slug, ?User $viewer): Crew
    {
        return app(CrewLookup::class)->visible($slug, $viewer);
    }

    /**
     * A member of the crew by their current username; 404 not_found otherwise.
     */
    private function membership(Crew $crew, string $username): CrewMember
    {
        $member = CrewMember::query()->with('user')->where('crew_id', $crew->id)
            ->whereHas('user', fn ($query) => $query->where('username', mb_strtolower(ltrim($username, '@'))))
            ->first();

        return $member instanceof CrewMember ? $member : throw new ApiException(ErrorCode::NotFound);
    }

    private function present(Crew $crew, ?User $viewer): CrewResource
    {
        $crew->load(['logo', 'cover', 'founderMembership.user.avatar']);
        app(CrewViewerState::class)->prepare([$crew], $viewer, counts: true);

        return new CrewResource($crew);
    }
}
