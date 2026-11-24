<?php

namespace App\Http\Resources\V1\Crews;

use App\Http\Resources\V1\MemberSummaryResource;
use App\Models\CrewInvite;
use App\Models\User;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An open invitation (contract-crews.md §2 CrewInvite): for the crew's admins (GET crews/{slug}/invites) and the invited member
 * (GET me/crew-invites).
 *
 * @property CrewInvite $resource
 */
class CrewInviteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $invite = $this->resource;
        $reader = Viewer::from($request);
        $inviter = $invite->inviter;

        return [
            'id' => $invite->id,
            'crew' => new CrewCardResource($invite->crew),
            'member' => new MemberSummaryResource($invite->user),
            /** @var MemberSummaryResource|null */
            // MF-1: never somebody the reader has a block with.
            'invited_by' => $inviter instanceof User && ! ($reader !== null && ! $reader->is($inviter) && $reader->hasBlockWith($inviter)) ? new MemberSummaryResource($inviter) : null,
            'created_at' => $invite->created_at?->toIso8601String(),
        ];
    }
}
