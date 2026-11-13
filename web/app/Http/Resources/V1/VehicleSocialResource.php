<?php

namespace App\Http\Resources\V1;

use App\Models\Vehicle;
use App\Models\VehicleFollow;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Social\Reactions;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * M4.11: the viewer's own reaction and build follow on VEH-01; the owner alone gets the counts (09 §8.5, §8.6, ADR-413). A key that is
 * the owner's is missing for everybody else, so no client can show it by mistake.
 *
 * @property Vehicle $resource
 */
class VehicleSocialResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource;
        $viewer = Viewer::from($request);
        $isOwner = $vehicle->isOwnedBy($viewer);
        $reactions = app(Reactions::class);
        // Guests never follow and never see a count: no flag read for them (the vehicle page keeps its query budget).
        $follows = $viewer !== null && app(FeatureFlags::class)->enabled('vehicle_follow');

        return [
            /**
             * The viewer's reaction [build_reactions]: strong, clean, low or loud. Null for guests, the owner, none yet, or the flag off.
             *
             * @var 'strong'|'clean'|'low'|'loud'|null
             */
            'my_reaction' => $isOwner ? null : $reactions->mine($viewer, $vehicle)?->value,
            /** The viewer follows this build [vehicle_follow]. Null for guests, the owner and while the flag is off. */
            'is_following' => $viewer === null || $isOwner || ! $follows
                ? null
                : VehicleFollow::query()->where('user_id', $viewer->id)->where('vehicle_id', $vehicle->id)->exists(),
            /** [build_comments] whether the owner allows comments on this vehicle's updates. */
            'comments_enabled' => $vehicle->getAttribute('comments_enabled') !== false,
            /**
             * Owner only: reactions on the build by kind and in total [build_reactions].
             *
             * @var array{strong: int, clean: int, low: int, loud: int, total: int}
             */
            'reaction_summary' => $this->when($isOwner && $reactions->enabled(), fn (): array => $reactions->summary($vehicle)),
            /** Owner only: how many members follow this build [vehicle_follow]. Never public (09 §8.6). */
            'followers_count' => $this->when($isOwner && $follows, fn (): int => VehicleFollow::query()->where('vehicle_id', $vehicle->id)->count()),
        ];
    }
}
