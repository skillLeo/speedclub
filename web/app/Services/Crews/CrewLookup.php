<?php

namespace App\Services\Crews;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Crew;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * A crew by the slug of a route (its slug, or the one it had before its last rename, C7) that the reader may see (CrewPolicy::view);
 * anything else is 404 crew_unavailable, the same answer for a crew that never existed.
 */
final class CrewLookup
{
    public function visible(string $slug, ?User $viewer): Crew
    {
        $slug = mb_strtolower($slug);
        $crew = Crew::query()->where('slug', $slug)->first() ?? Crew::query()->where('previous_slug', $slug)->first();

        if (! $crew instanceof Crew || ! Gate::forUser($viewer)->allows('view', $crew)) {
            throw new ApiException(ErrorCode::CrewUnavailable);
        }

        return $crew;
    }
}
