<?php

namespace App\Http\Resources\V1;

use App\Models\Reaction;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of the owner's reaction list (VEH-05 "Reaktionen"): who reacted how, newest first.
 *
 * @property Reaction $resource
 */
class ReactionRowResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $member = $this->resource->user;
        $at = $this->resource->getAttribute('updated_at');

        return [
            'member' => $member instanceof User ? new MemberSummaryResource($member) : null,
            'reaction' => $this->resource->type,
            /** @var string|null */
            'reacted_at' => $at instanceof CarbonInterface ? $at->toIso8601String() : null,
        ];
    }
}
