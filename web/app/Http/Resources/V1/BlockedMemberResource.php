<?php

namespace App\Http\Resources\V1;

use App\Models\User;
use App\Support\PivotTime;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of SET-08: the name the member blocked, as it was sent, and when. Nothing live of the blocked member (no current name, display
 * name or picture): those would show changes across the other side's own block, and a block by an old name would reveal the new one
 * (M2.1 review #1, amends ADR-189 d). Read from blockedUsers(), so `pivot` holds the block.
 *
 * @property User $resource
 */
class BlockedMemberResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var mixed $pivot */
        $pivot = $this->resource->getRelationValue('pivot');
        $snapshot = $pivot?->getAttribute('blocked_username');
        $name = is_string($snapshot) && $snapshot !== '' ? $snapshot : (string) $this->resource->username;

        return [
            /** The name as the member blocked it, lowercased. Unblock with this name. */
            'username' => (string) $name,
            /** When the member blocked them, ISO 8601. */
            'blocked_at' => PivotTime::iso($pivot?->getAttribute('created_at')),
        ];
    }
}
