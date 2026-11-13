<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * The organiser chip of an EventCard and EVT-02 (09 §7.10): the member summary, the cover of their main build for the car badge on the
 * avatar (only a build the reader may see in a list; EventPresenter loads it, null otherwise), and the verified badge.
 *
 * @property User $resource
 */
class EventOrganiserResource extends MemberSummaryResource
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
            /**
             * "Verifiziert" on the chip: a verified business or brand organiser (09 §8.10, M4.14). Always false until business profiles
             * and their verification exist; a member account is never verified.
             */
            'verified' => false,
        ];
    }
}
