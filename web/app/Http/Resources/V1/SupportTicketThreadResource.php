<?php

namespace App\Http\Resources\V1;

use App\Actions\Support\CreateSupportTicket;
use App\Enums\SupportCategory;
use App\Enums\SupportTicketStatus;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-15 thread (M3.4, ADM-26 replies): the ticket with its messages, oldest first, without the team's internal notes.
 *
 * @property SupportTicket $resource
 */
class SupportTicketThreadResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $messages = TicketMessage::query()->where('ticket_id', $this->resource->id)->where('internal', false)->orderBy('created_at')->orderBy('id')->get();

        return [
            'id' => $this->resource->id,
            'reference' => CreateSupportTicket::reference($this->resource),
            /** @var SupportCategory */
            'category' => $this->resource->category,
            'subject' => $this->resource->getAttribute('subject'),
            /** @var SupportTicketStatus */
            'status' => $this->resource->status,
            'created_at' => $this->resource->created_at?->toIso8601String(),
            'last_activity_at' => ($this->resource->last_activity_at ?? $this->resource->updated_at)?->toIso8601String(),
            /** @var list<TicketMessageResource> */
            'messages' => TicketMessageResource::collection($messages),
        ];
    }
}
