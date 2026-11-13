<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * An actor of a HOME-02 row (M4.8): the member summary plus the cover of their main build, for the car badge on the avatar, only when the
 * reader may see that build (NotificationFeed loads it with VisibleBuilds); null otherwise.
 *
 * @property User $resource
 */
class NotificationActorResource extends MemberSummaryResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $cover = $this->resource->relationLoaded('mainVehicleCover') ? $this->resource->getRelation('mainVehicleCover') : null;

        return [
            ...parent::toArray($request),
            'main_vehicle_cover' => $cover instanceof Media ? new MediaResource($cover) : null,
        ];
    }
}
