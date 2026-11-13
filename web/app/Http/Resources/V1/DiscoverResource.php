<?php

namespace App\Http\Resources\V1;

use App\Services\Discover\DiscoverPage;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * DISC-01 (FS-11) below the search field.
 *
 * @property DiscoverPage $resource
 */
class DiscoverResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $page = $this->resource;

        return [
            /**
             * Makes with at least one public build, most builds first, then by name.
             *
             * @var list<MakeTileResource>
             */
            'makes' => MakeTileResource::collection($page->makes),
            /**
             * "Kollektionen": saved searches with at least one build the viewer can find, in the editors' order. Empty hides the section.
             *
             * @var list<CollectionResource>
             */
            'collections' => CollectionResource::collection($page->collections),
            /**
             * "Beliebte Mods": the chips of `home/modules`. Empty hides the section.
             *
             * @var list<PopularModResource>
             */
            'popular_mods' => PopularModResource::collection($page->popularMods),
            /**
             * [SIG `sig.similar_builds`] "Mitglieder mit ähnlichen Autos", at most 8. Null for guests, a viewer without a public build,
             * no match, or the flag off: hide the section.
             *
             * @var list<MemberSearchResource>|null
             */
            'similar_members' => $page->similarMembers === null ? null : MemberSearchResource::collection($page->similarMembers),
            /**
             * M4.8 "Beliebte Modelle": at most 8 models with the most builds the reader may see. Empty hides the section.
             *
             * @var list<PopularModelResource>
             */
            'popular_models' => PopularModelResource::collection($page->popularModels),
            /**
             * M4.8 "Treffen am Wochenende": at most 6 events of the coming Saturday and Sunday (Europe/Berlin), soonest first; empty while
             * `events` is off.
             *
             * @var list<EventCardResource>
             */
            'weekend_events' => EventCardResource::collection($page->weekendEvents),
            /**
             * M4.8 "Neu": the 8 newest builds the reader may see (as `home/new-builds`).
             *
             * @var list<FeedVehicleResource>
             */
            'newest' => FeedVehicleResource::collection($page->newest),
        ];
    }
}
