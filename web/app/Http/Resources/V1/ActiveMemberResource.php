<?php

namespace App\Http\Resources\V1;

use App\Services\Home\ActiveMember;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * "Aktive Mitglieder" of HOME-01 and the suggestions of an empty "Folge ich": the owner row plus the car and the follow state.
 *
 * @property ActiveMember $resource
 */
class ActiveMemberResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            ...(new MemberSummaryResource($this->resource->member))->toArray($request),
            /**
             * "BMW M4 G82": the main build when it is listed, else the build changed last.
             */
            'car_line' => $this->resource->carLine,
            /**
             * DQ-293 "Skyline R34", "M4 G82", "Golf GTI VII": model and generation of the same build, no make, no engine.
             *
             * @var string|null
             */
            'car_short' => $this->resource->carShort,
            /** Whether the reader follows the member; false for guests. */
            'is_following' => $this->resource->isFollowing,
        ];
    }
}
