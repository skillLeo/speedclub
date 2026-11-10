<?php

namespace App\Http\Resources\V1;

use App\Services\Messaging\ConversationView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * MSG-02's header and composer state: a ConversationResource plus the pinned context card, typing and the read mark.
 *
 * @property ConversationView $resource
 */
class ConversationDetailResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $view = $this->resource;

        return [
            ...(new ConversationResource($view))->toArray($request),
            /** The pinned context card (the same vehicle as `vehicle`). */
            'context_vehicle' => $view->vehicle === null ? null : new ChatVehicleResource($view->vehicle),
            /** [SIG sig.msg_typing] The other member typed within the last 5 s. Always false around a pending request. */
            'other_typing' => $view->otherTyping,
            /**
             * [SIG sig.msg_read_receipts] The newest message the other member has read; only when both send read receipts and neither side
             * is a request, otherwise null.
             *
             * @var string|null
             */
            'other_read_message_id' => $view->otherReadMessageId,
        ];
    }
}
