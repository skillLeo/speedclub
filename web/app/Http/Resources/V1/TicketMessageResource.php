<?php

namespace App\Http\Resources\V1;

use App\Enums\TicketAuthorType;
use App\Models\TicketMessage;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-15 thread (M3.4): one message of the member's ticket, the member's own or the team's reply. Internal notes of the team never come
 * here; the team's author is "team", never a staff member's name.
 *
 * @property TicketMessage $resource
 */
class TicketMessageResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource->id,
            /** @var 'member'|'team' */
            'author' => $this->resource->author_type === TicketAuthorType::Staff ? 'team' : 'member',
            'body' => $this->resource->body,
            'created_at' => $this->resource->created_at->toIso8601String(),
        ];
    }
}
