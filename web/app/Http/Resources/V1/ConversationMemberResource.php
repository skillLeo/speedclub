<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Http\Request;

/**
 * The other member of a conversation (MSG-01 rows, MSG-02 header, DQ-1086/1096): the member summary plus their main build, for the
 * subtitle "fährt BMW M3" and the car badge on the avatar. Only a build the reader may see in a list (ConversationViews loads it with
 * VisibleBuilds); both are null otherwise, and the app falls back to the @handle.
 *
 * @property User $resource
 */
class ConversationMemberResource extends MemberSummaryResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource->relationLoaded('mainVehicle') ? $this->resource->getRelation('mainVehicle') : null;
        $vehicle = $vehicle instanceof Vehicle ? $vehicle : null;
        $presenter = app(VehiclePresenter::class);
        $cover = $vehicle === null ? null : $presenter->cover($vehicle, false);

        return [
            ...parent::toArray($request),
            /** The cover of the main build, for the car badge on the avatar (as on HOME-02). */
            'main_vehicle_cover' => $cover instanceof Media ? new MediaResource($cover) : null,
            /**
             * The main build: `title` is make and model ("BMW M3") for "fährt BMW M3"; `full_title` adds the generation.
             *
             * @var array{slug: string, title: string, full_title: string, is_sample: bool}|null
             */
            'main_vehicle' => $vehicle === null ? null : [
                'slug' => (string) $vehicle->slug,
                'title' => trim(($presenter->makeName($vehicle) ?? '').' '.($presenter->modelName($vehicle) ?? '')),
                'full_title' => $presenter->fullTitle($vehicle),
                'is_sample' => $vehicle->getAttribute('is_sample') === true,
            ],
        ];
    }
}
