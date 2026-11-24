<?php

namespace App\Http\Resources\V1\Crews;

use App\Http\Resources\V1\MemberSummaryResource;
use App\Models\CrewRequest;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An open join request (contract-crews.md §2 CrewRequest): for the crew's admins (GET crews/{slug}/requests) and the member
 * (GET me/crew-requests).
 *
 * @property CrewRequest $resource
 */
class CrewRequestResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $row = $this->resource;

        return [
            'id' => $row->id,
            'crew' => new CrewCardResource($row->crew),
            'member' => new MemberSummaryResource($row->user),
            'created_at' => $row->created_at?->toIso8601String(),
        ];
    }
}
