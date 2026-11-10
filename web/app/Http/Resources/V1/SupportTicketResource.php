<?php

namespace App\Http\Resources\V1;

use App\Actions\Support\CreateSupportTicket;
use App\Enums\SupportCategory;
use App\Enums\SupportTicketStatus;
use App\Models\SupportTicket;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-15: the ticket as created.
 *
 * @property SupportTicket $resource
 */
class SupportTicketResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource->id,
            /** "SC-7H2KQXMB", as the receipt mail names it. */
            'reference' => CreateSupportTicket::reference($this->resource),
            /** @var SupportCategory */
            'category' => $this->resource->category,
            'subject' => $this->resource->getAttribute('subject'),
            /** @var SupportTicketStatus */
            'status' => $this->resource->status,
            'created_at' => $this->resource->created_at?->toIso8601String(),
        ];
    }
}
