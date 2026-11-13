<?php

namespace App\Http\Resources\V1;

use App\Models\BuildUpdate;
use App\Models\Event;
use App\Models\Media;
use App\Models\Vehicle;
use App\Services\Home\ActiveMember;
use App\Services\Home\PopularMod;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The FS-2 modules of HOME-01 between "Neue Builds" and the stream. An empty list hides its section.
 *
 * @property array{build_of_week: array{vehicle: Vehicle, quote: string|null, week: string}|null, nearby_events: list<Event>, brands_in_focus: list<array{slug: string, name: string, vehicle_count: int, cover: Media|null}>, build_updates: list<BuildUpdate>, active_members: list<ActiveMember>, popular_mods: list<PopularMod>} $resource
 */
class HomeModulesResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $updates = new EloquentCollection($this->resource['build_updates']);
        $updates->loadMissing('photos');

        return [
            /**
             * M4.8 "Build der Woche": one build per ISO week (best ranked of the two weeks before), the hero left out; null when none.
             *
             * @var BuildOfWeekResource|null
             */
            'build_of_week' => $this->resource['build_of_week'] === null ? null : new BuildOfWeekResource($this->resource['build_of_week']),
            /**
             * M4.8 "Treffen in deiner Nähe": at most 2 upcoming events within 50 km of `lat`/`lng` (asked on demand, never stored); empty
             * without a point or while `events` is off: hide the module.
             *
             * @var list<EventCardResource>
             */
            'nearby_events' => EventCardResource::collection($this->resource['nearby_events']),
            /**
             * M4.8 "Marken im Fokus": at most 3 part brands most run on builds the reader may see. Empty hides the module.
             * (`workshops_nearby` joins with business profiles, M4.14.)
             *
             * @var list<BrandFocusResource>
             */
            'brands_in_focus' => BrandFocusResource::collection($this->resource['brands_in_focus']),
            /**
             * Deprecated since M4.8 (the 2.0 Home has no Build-Updates module; these updates are in the stream too).
             * At most 3, newest first; at most one per build and two per owner.
             *
             * @var list<BuildUpdateRowResource>
             */
            'build_updates' => BuildUpdateRowResource::collection($updates->all()),
            /**
             * At most 12, most recently active first.
             *
             * @var list<ActiveMemberResource>
             */
            'active_members' => ActiveMemberResource::collection($this->resource['active_members']),
            /**
             * At most 12, most built first.
             *
             * @var list<PopularModResource>
             */
            'popular_mods' => PopularModResource::collection($this->resource['popular_mods']),
        ];
    }
}
